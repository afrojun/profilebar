import Foundation

/// Serves an extension copy that keeps its native messaging port open for link routing. It sends the shared rules
/// whenever they change, routes URLs to other profiles, and opens tabs that other helpers route to this profile.
/// See docs/link-routing-design.md.
final class RoutingSession {
    static let messageTypes: Set = ["hello", "route", "opened"]
    private static let arrivalTimeout: DispatchTimeInterval = .seconds(2)

    private final class PendingArrival {
        let answered = DispatchSemaphore(value: 0)
        var reply: [String: Any] = [:]
    }

    private let send: ([String: Any]) -> Void
    private let settingsURL: URL
    private let lock = NSLock()
    private var pendingArrivals: [String: PendingArrival] = [:]
    private var sentSettings: LinkRoutingSettings?
    private var listener: ProfileRelayListener?
    private var settingsWatcher: DispatchSourceFileSystemObject?

    init(settingsURL: URL = LinkRoutingStore.fileURL, send: @escaping ([String: Any]) -> Void) {
        self.settingsURL = settingsURL
        self.send = send
    }

    func handle(_ message: [String: Any]) {
        switch message["type"] as? String {
        case "hello":
            start(profileDirectory: message["profileDirectory"] as? String)
        case "route":
            DispatchQueue.global().async { self.route(message) }
        case "opened":
            finishArrival(message)
        default:
            break
        }
    }

    func stop() {
        listener?.close()
        settingsWatcher?.cancel()
    }

    /// Every hello gets the current settings, which also tells the extension that this helper supports routing.
    /// Only an identified extension copy accepts tabs from other profiles.
    private func start(profileDirectory: String?) {
        sendSettings()
        watchSettings()
        guard listener == nil, let profileDirectory, ChromeProfile.isValidDirectory(profileDirectory) else { return }
        listener = try? ProfileRelayListener(profileDirectory: profileDirectory) { [weak self] request in
            self?.answerPeer(request) ?? ["ok": false, "started": false]
        }
    }

    private func route(_ message: [String: Any]) {
        var opened = false
        if let rawURL = message["url"] as? String, let url = ProfileBridge.webURL(rawURL),
            let directory = message["profileDirectory"] as? String, ChromeProfile.isValidDirectory(directory)
        {
            opened = (try? ProfileOpener.open([url], inProfileDirectory: directory)) != nil
        }
        send(["type": "routed", "requestId": message["requestId"] ?? NSNull(), "ok": opened])
    }

    private func answerPeer(_ request: [String: Any]) -> [String: Any] {
        switch request["type"] as? String {
        case "ping":
            return ["ok": true]
        case "open":
            guard let urls = request["urls"] as? [String], (1...100).contains(urls.count),
                urls.allSatisfy({ ProfileBridge.webURL($0) != nil })
            else { return ["ok": false, "started": false] }
            return openArrivals(urls)
        default:
            return ["ok": false, "started": false]
        }
    }

    /// Asks this extension copy to create the tabs, and waits briefly for it to confirm. Without an answer, the tabs
    /// may still open, so the reply says that delivery started.
    private func openArrivals(_ urls: [String]) -> [String: Any] {
        let requestID = UUID().uuidString
        let arrival = PendingArrival()
        lock.withLock { pendingArrivals[requestID] = arrival }
        send(["type": "open", "requestId": requestID, "urls": urls])
        let answered = arrival.answered.wait(timeout: .now() + Self.arrivalTimeout) == .success
        lock.withLock { pendingArrivals[requestID] = nil }
        guard answered else { return ["ok": false, "started": true] }
        return arrival.reply
    }

    private func finishArrival(_ message: [String: Any]) {
        guard let requestID = message["requestId"] as? String else { return }
        guard let arrival = lock.withLock({ pendingArrivals[requestID] }) else { return }
        arrival.reply = ["ok": message["ok"] as? Bool == true, "started": message["started"] as? Bool ?? true]
        arrival.answered.signal()
    }

    /// Sends the current rules, or why they cannot be read.
    private func sendSettings() {
        do {
            let settings = try LinkRoutingStore.load(from: settingsURL)
            lock.withLock { sentSettings = settings }
            send(["type": "settings", "settings": try settings.jsonObject()])
        } catch {
            lock.withLock { sentSettings = nil }
            send(["type": "settings", "error": LinkRoutingStore.unreadableMessage(for: error)])
        }
    }

    /// Folder events also fire for unrelated files, so the rules are sent again only when they changed.
    private func settingsFolderChanged() {
        let settings = try? LinkRoutingStore.load(from: settingsURL)
        guard lock.withLock({ settings == nil || settings != sentSettings }) else { return }
        sendSettings()
    }

    /// Saving replaces the file, which changes its folder, so the folder is watched rather than the file.
    private func watchSettings() {
        guard settingsWatcher == nil else { return }
        let folder = settingsURL.deletingLastPathComponent()
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let descriptor = open(folder.path, O_EVTONLY)
        guard descriptor >= 0 else { return }
        let watcher = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: descriptor, eventMask: .write, queue: .global())
        watcher.setEventHandler { [weak self] in self?.settingsFolderChanged() }
        watcher.setCancelHandler { close(descriptor) }
        watcher.resume()
        settingsWatcher = watcher
    }
}
