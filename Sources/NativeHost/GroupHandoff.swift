import Darwin
import Foundation

enum GroupHandoff {
    static func open(
        profile: ChromeProfile,
        urls: [URL],
        group: TabGroupDetails,
        extensionID: String
    ) throws -> Bool {
        guard GroupReceiverAvailability.canReceive(in: profile, extensionID: extensionID) else {
            try ChromeURLLauncher.open(profile, urls: urls)
            return false
        }

        let relay = try GroupRelay(payload: ["urls": urls.map(\.absoluteString), "group": group.dictionary])
        let receiver = URL(string: "chrome-extension://\(extensionID)/group-receiver.html#\(relay.token)")!
        try ChromeURLLauncher.open(profile, urls: [receiver])

        guard try relay.awaitClaim(seconds: 15) else {
            relay.closeListening()
            try ChromeURLLauncher.open(profile, urls: urls)
            return false
        }
        guard try relay.awaitCompletion(seconds: 20) else {
            throw ProfileBarError.message("The destination could not create the tab group.")
        }
        return true
    }

    static func handleReceiverRequest(_ request: [String: Any]) -> [String: Any] {
        guard
            let type = request["type"] as? String,
            ["claimGroup", "completeGroup"].contains(type),
            let token = request["token"] as? String,
            UUID(uuidString: token) != nil
        else { return ["ok": false, "error": "invalid_request"] }

        do {
            let message: [String: Any] =
                type == "claimGroup"
                ? ["type": "claim"]
                : ["type": "complete", "ok": request["ok"] as? Bool == true]
            return try GroupRelay.request(token: token.lowercased(), message: message)
        } catch {
            return ["ok": false, "error": "handoff_unavailable"]
        }
    }
}

enum GroupReceiverAvailability {
    static func canReceive(in profile: ChromeProfile, extensionID: String) -> Bool {
        let preferences = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Google/Chrome")
            .appendingPathComponent(profile.directory)
            .appendingPathComponent("Secure Preferences")
        guard let data = try? Data(contentsOf: preferences) else { return false }
        return supportsReceiver(data, extensionID: extensionID)
    }

    static func supportsReceiver(_ data: Data, extensionID: String) -> Bool {
        guard
            let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let extensions = root["extensions"] as? [String: Any],
            let settings = extensions["settings"] as? [String: Any],
            let installed = settings[extensionID] as? [String: Any],
            (installed["disable_reasons"] as? [Any] ?? []).isEmpty,
            let permissions = installed["active_permissions"] as? [String: Any],
            let api = permissions["api"] as? [String],
            api.contains("nativeMessaging")
        else { return false }

        let version =
            (installed["manifest"] as? [String: Any])?["version"] as? String
            ?? unpackedVersion(installed["path"] as? String)
        guard let version else { return false }
        let parts = version.split(separator: ".").compactMap { Int($0) }
        return parts.count >= 3 && !parts.prefix(3).lexicographicallyPrecedes([1, 8, 0])
    }

    private static func unpackedVersion(_ path: String?) -> String? {
        guard let path, path.hasPrefix("/") else { return nil }
        let manifest = URL(fileURLWithPath: path).appendingPathComponent("manifest.json")
        guard
            let data = try? Data(contentsOf: manifest),
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return object["version"] as? String
    }
}

final class GroupRelay {
    let token = UUID().uuidString.lowercased()
    private let directory: URL
    private let socketPath: String
    private let payload: [String: Any]
    private var listeningSocket: Int32 = -1

    init(payload: [String: Any]) throws {
        self.payload = payload
        directory = Self.directory(for: token)
        socketPath = directory.appendingPathComponent("relay.sock").path
        try FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700]
        )
        do {
            listeningSocket = try Self.makeSocket()
            var address = try Self.address(for: socketPath)
            let bound = withUnsafePointer(to: &address) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    Darwin.bind(listeningSocket, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
                }
            }
            guard bound == 0 else {
                throw ProfileBarError.message("Could not bind the group handoff: \(String(cString: strerror(errno))).")
            }
            guard Darwin.listen(listeningSocket, 2) == 0 else {
                throw ProfileBarError.message(
                    "Could not listen for the group handoff: \(String(cString: strerror(errno))).")
            }
        } catch {
            closeListening()
            _ = Darwin.rmdir(directory.path)
            throw error
        }
    }

    deinit {
        closeListening()
        _ = Darwin.rmdir(directory.path)
    }

    func closeListening() {
        if listeningSocket >= 0 {
            _ = Darwin.close(listeningSocket)
            listeningSocket = -1
        }
        _ = Darwin.unlink(socketPath)
    }

    func awaitClaim(seconds: Int32) throws -> Bool {
        guard let client = try accept(seconds: seconds) else { return false }
        defer { _ = Darwin.close(client) }
        let request = try Self.readFrame(client)
        guard request["type"] as? String == "claim" else {
            throw ProfileBarError.message("The destination sent an invalid group request.")
        }
        try Self.writeFrame(client, ["ok": true].merging(payload) { _, new in new })
        return true
    }

    func awaitCompletion(seconds: Int32) throws -> Bool {
        guard let client = try accept(seconds: seconds) else {
            throw ProfileBarError.message("The destination did not confirm the tab group.")
        }
        defer { _ = Darwin.close(client) }
        let request = try Self.readFrame(client)
        guard request["type"] as? String == "complete", let success = request["ok"] as? Bool else {
            throw ProfileBarError.message("The destination sent an invalid completion.")
        }
        try Self.writeFrame(client, ["ok": true])
        return success
    }

    static func request(token: String, message: [String: Any]) throws -> [String: Any] {
        let client = try makeSocket()
        defer { _ = Darwin.close(client) }
        let path = directory(for: token).appendingPathComponent("relay.sock").path
        var address = try address(for: path)
        let connected = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(client, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard connected == 0 else { throw ProfileBarError.message("The group handoff expired.") }
        try writeFrame(client, message)
        return try readFrame(client)
    }

    private func accept(seconds: Int32) throws -> Int32? {
        var descriptor = pollfd(fd: listeningSocket, events: Int16(POLLIN), revents: 0)
        let ready = Darwin.poll(&descriptor, 1, seconds * 1_000)
        if ready == 0 { return nil }
        guard ready > 0 else { throw ProfileBarError.message("The group handoff failed.") }
        let client = Darwin.accept(listeningSocket, nil, nil)
        guard client >= 0 else { throw ProfileBarError.message("The group handoff failed.") }
        Self.setSocketOptions(client)
        return client
    }

    private static func directory(for token: String) -> URL {
        URL(fileURLWithPath: "/private/tmp/pbg-\(token)", isDirectory: true)
    }

    private static func address(for path: String) throws -> sockaddr_un {
        var result = sockaddr_un()
        let bytes = Array(path.utf8) + [0]
        guard bytes.count <= MemoryLayout.size(ofValue: result.sun_path) else {
            throw ProfileBarError.message("The group handoff path is too long.")
        }
        result.sun_family = sa_family_t(AF_UNIX)
        result.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        withUnsafeMutableBytes(of: &result.sun_path) { $0.copyBytes(from: bytes) }
        return result
    }

    private static func makeSocket() throws -> Int32 {
        let descriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw ProfileBarError.message("Could not open the group handoff.") }
        setSocketOptions(descriptor)
        return descriptor
    }

    private static func setSocketOptions(_ descriptor: Int32) {
        var enabled: Int32 = 1
        _ = Darwin.setsockopt(
            descriptor, SOL_SOCKET, SO_NOSIGPIPE, &enabled, socklen_t(MemoryLayout.size(ofValue: enabled)))
        var timeout = timeval(tv_sec: 5, tv_usec: 0)
        _ = Darwin.setsockopt(
            descriptor, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout.size(ofValue: timeout)))
    }

    private static func readFrame(_ descriptor: Int32) throws -> [String: Any] {
        let header = try readBytes(descriptor, count: 4)
        let length = header.enumerated().reduce(UInt32(0)) { size, byte in
            size | UInt32(byte.element) << (byte.offset * 8)
        }
        guard length > 0 && length <= 131_072 else {
            throw ProfileBarError.message("The group handoff message is invalid.")
        }
        let data = Data(try readBytes(descriptor, count: Int(length)))
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw ProfileBarError.message("The group handoff message is invalid.")
        }
        return object
    }

    private static func readBytes(_ descriptor: Int32, count: Int) throws -> [UInt8] {
        var bytes = [UInt8](repeating: 0, count: count)
        var offset = 0
        while offset < count {
            let amount = bytes.withUnsafeMutableBytes { buffer in
                Darwin.read(descriptor, buffer.baseAddress!.advanced(by: offset), count - offset)
            }
            guard amount > 0 else { throw ProfileBarError.message("The group handoff was interrupted.") }
            offset += amount
        }
        return bytes
    }

    private static func writeFrame(_ descriptor: Int32, _ object: [String: Any]) throws {
        let data = try JSONSerialization.data(withJSONObject: object)
        guard data.count <= 131_072 else { throw ProfileBarError.message("The group handoff is too large.") }
        let length = UInt32(data.count)
        let header = (0..<4).map { UInt8((length >> ($0 * 8)) & 0xff) }
        try writeBytes(descriptor, header + data)
    }

    private static func writeBytes(_ descriptor: Int32, _ bytes: [UInt8]) throws {
        var offset = 0
        while offset < bytes.count {
            let amount = bytes.withUnsafeBytes { buffer in
                Darwin.write(descriptor, buffer.baseAddress!.advanced(by: offset), bytes.count - offset)
            }
            guard amount > 0 else { throw ProfileBarError.message("The group handoff was interrupted.") }
            offset += amount
        }
    }
}
