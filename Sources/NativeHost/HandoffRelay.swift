import Darwin
import Foundation

/// Hands a payload to an extension page that ProfileBar opened in a chosen profile. The page finds the relay by
/// the token in its URL. Group moves and profile identification use it.
final class HandoffRelay {
    /// Requests from the destination page, which reach this relay through the page's own helper process.
    static let receiverRequestTypes: Set = ["claimGroup", "claimIdentity", "completeGroup"]

    let token = UUID().uuidString.lowercased()
    private let directory: URL
    private let socketPath: String
    private let payload: [String: Any]
    private var listeningSocket: Int32 = -1

    init(payload: [String: Any]) throws {
        self.payload = payload
        directory = Self.directory(for: token)
        socketPath = Self.socketPath(for: token)
        try FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700]
        )
        do {
            listeningSocket = try LocalSocket.listen(at: socketPath)
        } catch {
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
        guard let client = try LocalSocket.accept(listeningSocket, seconds: seconds) else { return false }
        defer { _ = Darwin.close(client) }
        let request = try LocalSocket.readFrame(client)
        guard request["type"] as? String == "claim" else {
            throw ProfileBarError.message("The destination sent an invalid handoff request.")
        }
        try LocalSocket.writeFrame(client, ["ok": true].merging(payload) { _, new in new })
        return true
    }

    func awaitCompletion(seconds: Int32) throws -> Bool {
        guard let client = try LocalSocket.accept(listeningSocket, seconds: seconds) else {
            throw ProfileBarError.message("The destination did not confirm the handoff.")
        }
        defer { _ = Darwin.close(client) }
        let request = try LocalSocket.readFrame(client)
        guard request["type"] as? String == "complete", let success = request["ok"] as? Bool else {
            throw ProfileBarError.message("The destination sent an invalid completion.")
        }
        try LocalSocket.writeFrame(client, ["ok": true])
        return success
    }

    static func request(token: String, message: [String: Any]) throws -> [String: Any] {
        try LocalSocket.exchange(at: socketPath(for: token), message)
    }

    /// Passes the destination page's claim or completion to the relay that its token names.
    static func handleReceiverRequest(_ request: [String: Any]) -> [String: Any] {
        let message: [String: Any]
        switch request["type"] as? String {
        case "claimGroup", "claimIdentity":
            message = ["type": "claim"]
        case "completeGroup":
            message = ["type": "complete", "ok": request["ok"] as? Bool == true]
        default:
            return ["ok": false, "error": "invalid_request"]
        }
        guard let token = request["token"] as? String, UUID(uuidString: token) != nil else {
            return ["ok": false, "error": "invalid_request"]
        }
        do {
            return try Self.request(token: token.lowercased(), message: message)
        } catch {
            return ["ok": false, "error": "handoff_unavailable"]
        }
    }

    private static func directory(for token: String) -> URL {
        URL(fileURLWithPath: "/private/tmp/pbg-\(token)", isDirectory: true)
    }

    private static func socketPath(for token: String) -> String {
        directory(for: token).appendingPathComponent("relay.sock").path
    }
}
