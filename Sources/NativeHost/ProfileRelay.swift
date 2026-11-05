import Darwin
import Foundation

/// Lets helpers open tabs in each other's profiles. The helper for each identified extension copy listens on a
/// socket named after its profile directory, and that extension copy creates the tabs itself.
enum ProfileRelay {
    static var socketDirectory: URL {
        URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("\(ProfileBarVariant.folderName) Routes", isDirectory: true)
    }

    static func socketPath(for profileDirectory: String) -> String {
        let name = profileDirectory.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? profileDirectory
        return socketDirectory.appendingPathComponent("\(name).sock").path
    }

    enum Delivery {
        case opened
        /// Nothing opened, so opening the URLs another way is safe.
        case declined
        /// Some tabs may have opened, so opening the URLs another way could duplicate them.
        case uncertain
    }

    /// Asks the profile's extension copy to open the URLs.
    static func requestOpen(
        _ urls: [URL], splits: TabSplits = .none, inProfileDirectory directory: String
    ) -> Delivery {
        guard let client = try? LocalSocket.connect(to: socketPath(for: directory)) else { return .declined }
        defer { _ = Darwin.close(client) }
        let request: [String: Any] = ["type": "open", "urls": urls.map(\.absoluteString), "splits": splits.pairs]
        guard (try? LocalSocket.writeFrame(client, request)) != nil else { return .declined }
        guard let reply = try? LocalSocket.readFrame(client) else { return .uncertain }
        if reply["ok"] as? Bool == true { return .opened }
        return reply["started"] as? Bool == false ? .declined : .uncertain
    }

    static func isListening(profileDirectory: String) -> Bool {
        (try? LocalSocket.exchange(at: socketPath(for: profileDirectory), ["type": "ping"]))?["ok"] as? Bool == true
    }
}

final class ProfileRelayListener {
    private let path: String
    private let descriptor: Int32
    private let inode: ino_t

    /// Calls `handle` on a background thread for each request and sends back its reply.
    init(profileDirectory: String, handle: @escaping ([String: Any]) -> [String: Any]) throws {
        try FileManager.default.createDirectory(
            at: ProfileRelay.socketDirectory, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        path = ProfileRelay.socketPath(for: profileDirectory)
        // A newer helper takes over from an older one for the same profile, which may still be exiting.
        _ = Darwin.unlink(path)
        descriptor = try LocalSocket.listen(at: path)
        var status = stat()
        guard lstat(path, &status) == 0 else {
            _ = Darwin.close(descriptor)
            throw ProfileBarError.message("The profile relay socket disappeared.")
        }
        inode = status.st_ino

        // The loop ends when close() closes the listening socket.
        let listeningSocket = descriptor
        Thread.detachNewThread {
            while let client = try? LocalSocket.accept(listeningSocket, seconds: nil) {
                DispatchQueue.global().async {
                    defer { _ = Darwin.close(client) }
                    guard let request = try? LocalSocket.readFrame(client) else { return }
                    try? LocalSocket.writeFrame(client, handle(request))
                }
            }
        }
    }

    /// Removes the socket unless a newer helper for the same profile has replaced it.
    func close() {
        var status = stat()
        if lstat(path, &status) == 0 && status.st_ino == inode {
            _ = Darwin.unlink(path)
        }
        _ = Darwin.close(descriptor)
    }
}

enum ProfileOpener {
    /// Opens the URLs through the profile's own extension copy when it is connected, so they arrive as tabs that are
    /// never routed. Otherwise it asks Chrome to open them in that profile.
    static func open(_ urls: [URL], splits: TabSplits = .none, inProfileDirectory directory: String) throws {
        switch ProfileRelay.requestOpen(urls, splits: splits, inProfileDirectory: directory) {
        case .opened:
            return
        case .declined:
            try ChromeURLLauncher.open(profileDirectory: directory, urls: urls)
        case .uncertain:
            throw ProfileBarError.message(
                "That profile may already have opened the page, so the original tab stays open.")
        }
    }
}
