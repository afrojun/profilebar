import Foundation

enum GroupHandoff {
    static func open(
        profile: ChromeProfile,
        urls: [URL],
        group: TabGroupDetails,
        extensionID: String
    ) throws -> Bool {
        guard ProfileExtensionAvailability.isEnabled(in: profile, extensionID: extensionID) else {
            try ChromeURLLauncher.open(profile, urls: urls)
            return false
        }

        let relay = try HandoffRelay(payload: ["urls": urls.map(\.absoluteString), "group": group.dictionary])
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
}

enum ProfileExtensionAvailability {
    static func isEnabled(in profile: ChromeProfile, extensionID: String) -> Bool {
        let preferences = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Google/Chrome")
            .appendingPathComponent(profile.directory)
            .appendingPathComponent("Secure Preferences")
        guard let data = try? Data(contentsOf: preferences) else { return false }
        return isEnabled(preferences: data, extensionID: extensionID)
    }

    static func isEnabled(preferences data: Data, extensionID: String) -> Bool {
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
        return true
    }
}
