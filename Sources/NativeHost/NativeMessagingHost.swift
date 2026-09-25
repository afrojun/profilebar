import Foundation

@main
struct NativeMessagingHost {
    static func main() {
        do {
            guard let header = try readExactly(4) else { return }
            let length = header.enumerated().reduce(UInt32(0)) { size, byte in
                size | UInt32(byte.element) << (byte.offset * 8)
            }
            guard length > 0 && length <= 131_072 else { return }
            guard let data = try readExactly(Int(length)) else { return }
            let request = (try JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            let bridge = ProfileBridge(loadProfiles: ChromeProfileStore.load, openURLs: ChromeURLLauncher.open)
            let response = bridge.handle(request)
            let responseData = try JSONSerialization.data(withJSONObject: response)
            let responseLength = UInt32(responseData.count)
            let responseHeader = Data((0..<4).map { UInt8((responseLength >> ($0 * 8)) & 0xff) })
            FileHandle.standardOutput.write(responseHeader)
            FileHandle.standardOutput.write(responseData)
        } catch {
            let message = Data(#"{"ok":false,"error":"operation_failed"}"#.utf8)
            let length = UInt32(message.count)
            FileHandle.standardOutput.write(Data((0..<4).map { UInt8((length >> ($0 * 8)) & 0xff) }))
            FileHandle.standardOutput.write(message)
        }
    }

    private static func readExactly(_ count: Int) throws -> Data? {
        var data = Data()
        while data.count < count {
            guard let next = try FileHandle.standardInput.read(upToCount: count - data.count), !next.isEmpty else {
                return nil
            }
            data.append(next)
        }
        return data
    }
}
