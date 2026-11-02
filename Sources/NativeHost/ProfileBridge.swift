import Foundation

struct ProfileBridge {
    let loadProfiles: () throws -> [ChromeProfile]
    let focusedProfile: ([ChromeProfile]) -> ChromeProfile?
    let openURLs: (ChromeProfile, [URL]) throws -> Void
    let openGroup: (ChromeProfile, [URL], TabGroupDetails, String) throws -> Bool
    let openProfileSettings: (ChromeProfile, String) throws -> Bool
    let saveLinkRouting: (LinkRoutingSettings) throws -> Void
    let identifyProfiles: ([ChromeProfile], String) -> ProfileIdentification.Result

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
            case "openProfileSettings":
                guard
                    let directory = request["profileDirectory"] as? String,
                    let callerExtensionID = Self.validExtensionID(callerExtensionID)
                else { return failure("invalid_request") }
                guard let profile = try loadProfiles().first(where: { $0.directory == directory }) else {
                    return failure("profile_not_found")
                }
                return ["ok": true, "opened": try openProfileSettings(profile, callerExtensionID)]
            case "identifyProfiles":
                guard let callerExtensionID = Self.validExtensionID(callerExtensionID) else {
                    return failure("invalid_request")
                }
                let result = identifyProfiles(try loadProfiles(), callerExtensionID)
                return ["ok": true, "identified": result.identified, "unreachable": result.unreachable]
            case "saveLinkRouting":
                guard let settings = try? LinkRoutingSettings(jsonObject: request["settings"] ?? NSNull()) else {
                    return failure("invalid_request")
                }
                do {
                    try saveLinkRouting(settings)
                    return ["ok": true]
                } catch let error as LinkRoutingError {
                    var response: [String: Any] = [
                        "ok": false, "error": error.reason.rawValue, "message": error.message,
                    ]
                    response["ruleIndex"] = error.ruleIndex
                    return response
                }
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

                let urls = rawURLs.compactMap(Self.webURL)
                guard urls.count == rawURLs.count else { return failure("invalid_request") }

                guard let profile = try loadProfiles().first(where: { $0.directory == directory }) else {
                    return failure("profile_not_found")
                }
                if command == "openGroup" {
                    guard
                        let group = TabGroupDetails.parse(request["group"]),
                        let callerExtensionID = Self.validExtensionID(callerExtensionID)
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

    /// Returns the URL when it is an HTTP or HTTPS address of a supported size.
    static func webURL(_ rawURL: String) -> URL? {
        guard
            rawURL.utf8.count <= 65_536,
            let url = URL(string: rawURL),
            ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
            url.host != nil
        else { return nil }
        return url
    }

    private func failure(_ code: String) -> [String: Any] {
        ["ok": false, "error": code]
    }

    private static func validExtensionID(_ extensionID: String?) -> String? {
        guard
            let extensionID,
            extensionID.count == 32,
            extensionID.allSatisfy({ ("a"..."p").contains(String($0)) })
        else { return nil }
        return extensionID
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

enum ChromeProfileSettingsLauncher {
    /// Chrome opens its settings pages for extensions but not from the command line, so this opens
    /// the extension's relay page in the profile, which shows that profile's settings.
    static func open(_ profile: ChromeProfile, extensionID: String) throws -> Bool {
        guard ProfileExtensionAvailability.isEnabled(in: profile, extensionID: extensionID) else { return false }
        try ChromeURLLauncher.open(
            profile, urls: [URL(string: "chrome-extension://\(extensionID)/manage-profile.html")!])
        return true
    }
}

/// Tells each profile's extension copy which profile it runs in. See "Profile identity" in
/// docs/link-routing-design.md.
enum ProfileIdentification {
    struct Result {
        /// Directories of profiles whose extension copy knows its profile.
        var identified: [String]
        /// Directories of profiles with the extension enabled that did not answer.
        var unreachable: [String]
    }

    static func identify(_ profiles: [ChromeProfile], extensionID: String) -> Result {
        let enabled = profiles.filter { ProfileExtensionAvailability.isEnabled(in: $0, extensionID: extensionID) }
        let answers = NSLock()
        var identified: Set<String> = []
        DispatchQueue.concurrentPerform(iterations: enabled.count) { index in
            let profile = enabled[index]
            let knowsProfile =
                ProfileRelay.isListening(profileDirectory: profile.directory)
                || (try? tellProfile(profile, extensionID: extensionID)) == true
            if knowsProfile { answers.withLock { _ = identified.insert(profile.directory) } }
        }
        let directories = enabled.map(\.directory)
        return Result(
            identified: directories.filter(identified.contains),
            unreachable: directories.filter { !identified.contains($0) })
    }

    /// Opens the extension's identify page in the profile. The page claims the relay and stores the directory.
    private static func tellProfile(_ profile: ChromeProfile, extensionID: String) throws -> Bool {
        let relay = try HandoffRelay(payload: ["profileDirectory": profile.directory])
        let page = URL(string: "chrome-extension://\(extensionID)/identify.html#\(relay.token)")!
        try ChromeURLLauncher.open(profile, urls: [page])
        return try relay.awaitClaim(seconds: 15)
    }
}

enum ChromeURLLauncher {
    static func open(_ profile: ChromeProfile, urls: [URL]) throws {
        try open(profileDirectory: profile.directory, urls: urls)
    }

    static func open(profileDirectory: String, urls: [URL]) throws {
        guard ChromeProfile.isValidDirectory(profileDirectory) else {
            throw ProfileBarError.message("The Chrome profile directory is invalid.")
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        process.arguments =
            ["-na", "Google Chrome", "--args", "--profile-directory=\(profileDirectory)"]
            + urls.map(\.absoluteString)
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw ProfileBarError.message("Chrome could not open the page.")
        }
    }
}
