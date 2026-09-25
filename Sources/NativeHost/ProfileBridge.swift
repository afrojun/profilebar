import Foundation

struct ProfileBridge {
    let loadProfiles: () throws -> [ChromeProfile]
    let openURLs: (ChromeProfile, [URL]) throws -> Void

    func handle(_ request: [String: Any]) -> [String: Any] {
        do {
            switch request["type"] as? String {
            case "listProfiles":
                let profiles = try loadProfiles().map { ["directory": $0.directory, "name": $0.name] }
                return ["ok": true, "profiles": profiles]
            case "openURL", "openURLs":
                let rawURLs: [String]?
                if request["type"] as? String == "openURL" {
                    rawURLs = (request["url"] as? String).map { [$0] }
                } else {
                    rawURLs = request["urls"] as? [String]
                }
                guard
                    let directory = request["profileDirectory"] as? String,
                    let rawURLs,
                    !rawURLs.isEmpty,
                    rawURLs.count <= 100,
                    rawURLs.reduce(0, { $0 + $1.utf8.count }) <= 120_000
                else { return failure("invalid_request") }

                let urls = rawURLs.compactMap { rawURL -> URL? in
                    guard
                        rawURL.utf8.count <= 65_536,
                        let url = URL(string: rawURL),
                        ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
                        url.host != nil
                    else { return nil }
                    return url
                }
                guard urls.count == rawURLs.count else { return failure("invalid_request") }

                guard let profile = try loadProfiles().first(where: { $0.directory == directory }) else {
                    return failure("profile_not_found")
                }
                try openURLs(profile, urls)
                return ["ok": true]
            default:
                return failure("invalid_request")
            }
        } catch {
            return failure("operation_failed")
        }
    }

    private func failure(_ code: String) -> [String: Any] {
        ["ok": false, "error": code]
    }
}

enum ChromeURLLauncher {
    static func open(_ profile: ChromeProfile, urls: [URL]) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        process.arguments =
            ["-na", "Google Chrome", "--args", "--profile-directory=\(profile.directory)"]
            + urls.map(\.absoluteString)
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw ProfileBarError.message("Chrome could not open the page.")
        }
    }
}
