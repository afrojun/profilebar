import Foundation

/// Chrome starts one helper per `sendNativeMessage` call, and keeps one running for each `connectNative` port.
/// The helper reads requests until Chrome closes its input, so it serves both.
@main
struct NativeMessagingHost {
    static func main() {
        let output = MessageOutput()
        let origin = CommandLine.arguments.dropFirst().first ?? ""
        let extensionID =
            origin.hasPrefix("chrome-extension://") && origin.hasSuffix("/")
            ? String(origin.dropFirst("chrome-extension://".count).dropLast())
            : nil
        let bridge = ProfileBridge(
            loadProfiles: ChromeProfileStore.load,
            focusedProfile: ChromeFocusedProfile.detect,
            openURLs: { profile, urls, splits in
                try ProfileOpener.open(urls, splits: splits, inProfileDirectory: profile.directory)
            },
            openGroup: GroupHandoff.open,
            openProfileSettings: ChromeProfileSettingsLauncher.open,
            saveLinkRouting: { try LinkRoutingStore.save($0) },
            identifyProfiles: ProfileIdentification.identify
        )
        var session: RoutingSession?

        while let request = readRequest() {
            let type = request["type"] as? String ?? ""
            if RoutingSession.messageTypes.contains(type) {
                if session == nil { session = RoutingSession(send: output.write) }
                session?.handle(request)
            } else if HandoffRelay.receiverRequestTypes.contains(type) {
                output.write(HandoffRelay.handleReceiverRequest(request))
            } else {
                output.write(bridge.handle(request, callerExtensionID: extensionID))
            }
        }
        session?.stop()
    }

    /// Returns nil when Chrome closes the input or sends an oversized message.
    private static func readRequest() -> [String: Any]? {
        guard let header = readExactly(4) else { return nil }
        let length = header.enumerated().reduce(UInt32(0)) { size, byte in
            size | UInt32(byte.element) << (byte.offset * 8)
        }
        guard length > 0 && length <= 131_072, let data = readExactly(Int(length)) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }

    private static func readExactly(_ count: Int) -> Data? {
        var data = Data()
        while data.count < count {
            guard let next = try? FileHandle.standardInput.read(upToCount: count - data.count), !next.isEmpty else {
                return nil
            }
            data.append(next)
        }
        return data
    }
}

/// Writes length-prefixed messages to Chrome. Routing threads and the request loop share it.
final class MessageOutput {
    private let lock = NSLock()

    func write(_ message: [String: Any]) {
        let data =
            (try? JSONSerialization.data(withJSONObject: message))
            ?? Data(#"{"ok":false,"error":"operation_failed"}"#.utf8)
        let length = UInt32(data.count)
        let header = Data((0..<4).map { UInt8((length >> ($0 * 8)) & 0xff) })
        lock.withLock { FileHandle.standardOutput.write(header + data) }
    }
}
