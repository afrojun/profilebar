import Darwin
import Foundation

/// Unix-domain stream sockets that carry length-prefixed JSON frames between ProfileBar's helpers.
enum LocalSocket {
    static let maximumFrameSize = 131_072

    static func listen(at path: String) throws -> Int32 {
        let descriptor = try makeSocket()
        do {
            var address = try address(for: path)
            let bound = withUnsafePointer(to: &address) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    Darwin.bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
                }
            }
            guard bound == 0 else {
                throw ProfileBarError.message("Could not bind a local socket: \(String(cString: strerror(errno))).")
            }
            guard Darwin.listen(descriptor, 8) == 0 else {
                throw ProfileBarError.message(
                    "Could not listen on a local socket: \(String(cString: strerror(errno))).")
            }
            return descriptor
        } catch {
            _ = Darwin.close(descriptor)
            throw error
        }
    }

    /// Waits for a connection. Returns nil when `seconds` pass first, and waits indefinitely when `seconds` is nil.
    static func accept(_ listeningSocket: Int32, seconds: Int32?) throws -> Int32? {
        var descriptor = pollfd(fd: listeningSocket, events: Int16(POLLIN), revents: 0)
        let ready = Darwin.poll(&descriptor, 1, seconds.map { $0 * 1_000 } ?? -1)
        if ready == 0 { return nil }
        guard ready > 0, descriptor.revents & Int16(POLLIN) != 0 else {
            throw ProfileBarError.message("A local socket stopped listening.")
        }
        let client = Darwin.accept(listeningSocket, nil, nil)
        guard client >= 0 else { throw ProfileBarError.message("A local socket could not accept a connection.") }
        setOptions(client)
        return client
    }

    static func connect(to path: String) throws -> Int32 {
        let descriptor = try makeSocket()
        var address = try address(for: path)
        let connected = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard connected == 0 else {
            _ = Darwin.close(descriptor)
            throw ProfileBarError.message("Nothing is listening on the local socket.")
        }
        return descriptor
    }

    /// Connects, sends one message, and returns the reply.
    static func exchange(at path: String, _ message: [String: Any]) throws -> [String: Any] {
        let client = try connect(to: path)
        defer { _ = Darwin.close(client) }
        try writeFrame(client, message)
        return try readFrame(client)
    }

    static func readFrame(_ descriptor: Int32) throws -> [String: Any] {
        let header = try readBytes(descriptor, count: 4)
        let length = header.enumerated().reduce(UInt32(0)) { size, byte in
            size | UInt32(byte.element) << (byte.offset * 8)
        }
        guard length > 0 && length <= maximumFrameSize else {
            throw ProfileBarError.message("A local message is invalid.")
        }
        let data = Data(try readBytes(descriptor, count: Int(length)))
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw ProfileBarError.message("A local message is invalid.")
        }
        return object
    }

    static func writeFrame(_ descriptor: Int32, _ object: [String: Any]) throws {
        let data = try JSONSerialization.data(withJSONObject: object)
        guard data.count <= maximumFrameSize else { throw ProfileBarError.message("A local message is too large.") }
        let length = UInt32(data.count)
        let header = (0..<4).map { UInt8((length >> ($0 * 8)) & 0xff) }
        try writeBytes(descriptor, header + data)
    }

    private static func makeSocket() throws -> Int32 {
        let descriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw ProfileBarError.message("Could not open a local socket.") }
        setOptions(descriptor)
        return descriptor
    }

    private static func setOptions(_ descriptor: Int32) {
        var enabled: Int32 = 1
        _ = Darwin.setsockopt(
            descriptor, SOL_SOCKET, SO_NOSIGPIPE, &enabled, socklen_t(MemoryLayout.size(ofValue: enabled)))
        var timeout = timeval(tv_sec: 5, tv_usec: 0)
        _ = Darwin.setsockopt(
            descriptor, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout.size(ofValue: timeout)))
    }

    private static func address(for path: String) throws -> sockaddr_un {
        var result = sockaddr_un()
        let bytes = Array(path.utf8) + [0]
        guard bytes.count <= MemoryLayout.size(ofValue: result.sun_path) else {
            throw ProfileBarError.message("The local socket path is too long.")
        }
        result.sun_family = sa_family_t(AF_UNIX)
        result.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        withUnsafeMutableBytes(of: &result.sun_path) { $0.copyBytes(from: bytes) }
        return result
    }

    private static func readBytes(_ descriptor: Int32, count: Int) throws -> [UInt8] {
        var bytes = [UInt8](repeating: 0, count: count)
        var offset = 0
        while offset < count {
            let amount = bytes.withUnsafeMutableBytes { buffer in
                Darwin.read(descriptor, buffer.baseAddress!.advanced(by: offset), count - offset)
            }
            guard amount > 0 else { throw ProfileBarError.message("A local message was interrupted.") }
            offset += amount
        }
        return bytes
    }

    private static func writeBytes(_ descriptor: Int32, _ bytes: [UInt8]) throws {
        var offset = 0
        while offset < bytes.count {
            let amount = bytes.withUnsafeBytes { buffer in
                Darwin.write(descriptor, buffer.baseAddress!.advanced(by: offset), bytes.count - offset)
            }
            guard amount > 0 else { throw ProfileBarError.message("A local message was interrupted.") }
            offset += amount
        }
    }
}
