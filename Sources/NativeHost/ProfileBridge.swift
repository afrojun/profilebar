import Foundation

struct ProfileBridge {
    let loadProfiles: () throws -> [ChromeProfile]
    let focusedProfile: ([ChromeProfile]) -> ChromeProfile?
    let openURLs: (ChromeProfile, [URL]) throws -> Void
    let openGroup: (ChromeProfile, [URL], TabGroupDetails, String) throws -> Bool

    func handle(_ request: [String: Any], callerExtensionID: String? = nil) -> [String: Any] {
        do {
            let command = request["type"] as? String
            switch command {
            case "listProfiles":
                let profiles = try loadProfiles()
                var response: [String: Any] = [
                    "ok": true,
                    "profiles": profiles.map { ["directory": $0.directory, "name": $0.name] },
                ]
                if let current = focusedProfile(profiles) {
                    response["focusedProfileDirectory"] = current.directory
                }
                return response
            case "openURL", "openURLs", "openGroup":
                let rawURLs: [String]?
                if command == "openURL" {
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
                if command == "openGroup" {
                    guard
                        let group = TabGroupDetails.parse(request["group"]),
                        let callerExtensionID,
                        callerExtensionID.count == 32,
                        callerExtensionID.allSatisfy({ ("a"..."p").contains(String($0)) })
                    else { return failure("invalid_request") }
                    let grouped = try openGroup(profile, urls, group, callerExtensionID)
                    return ["ok": true, "grouped": grouped]
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

struct TabGroupDetails {
    let title: String
    let color: String
    let collapsed: Bool

    static func parse(_ value: Any?) -> Self? {
        guard
            let object = value as? [String: Any],
            let title = object["title"] as? String,
            title.utf8.count <= 256,
            let color = object["color"] as? String,
            ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"].contains(color),
            let collapsed = object["collapsed"] as? Bool
        else { return nil }
        return Self(title: title, color: color, collapsed: collapsed)
    }

    var dictionary: [String: Any] {
        ["title": title, "color": color, "collapsed": collapsed]
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
