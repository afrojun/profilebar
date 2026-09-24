import Foundation

struct ChromeProfile: Equatable {
    let directory: String
    let name: String
    let personName: String?

    init(directory: String, name: String, personName: String?) throws {
        guard Self.isValidDirectory(directory) else {
            throw ProfileBarError.message("The Chrome profile directory is invalid.")
        }
        self.directory = directory
        self.name = name
        self.personName = personName
    }

    private static func isValidDirectory(_ directory: String) -> Bool {
        !directory.isEmpty
            && directory != "."
            && directory != ".."
            && !directory.contains("/")
            && !directory.contains("\\")
            && !directory.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
    }
}

enum ProfileBarError: LocalizedError {
    case accessibilityAccessRequired
    case message(String)

    var errorDescription: String? {
        switch self {
        case .accessibilityAccessRequired:
            "Accessibility access is needed to switch to an open Chrome profile."
        case .message(let message):
            message
        }
    }
}

enum ChromeProfileStore {
    static func load() throws -> [ChromeProfile] {
        let localStateURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Google/Chrome/Local State")
        let data = try Data(contentsOf: localStateURL)
        return try parse(data)
    }

    static func parse(_ data: Data) throws -> [ChromeProfile] {
        guard
            let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let profile = root["profile"] as? [String: Any],
            let cache = profile["info_cache"] as? [String: [String: Any]]
        else {
            throw ProfileBarError.message("Chrome's profile list could not be read.")
        }

        return try cache.map { directory, details in
            let name =
                nonEmpty(details["name"] as? String)
                ?? nonEmpty(details["shortcut_name"] as? String)
                ?? directory
            return try ChromeProfile(
                directory: directory,
                name: name,
                personName: nonEmpty(details["gaia_given_name"] as? String)
            )
        }.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private static func nonEmpty(_ value: String?) -> String? {
        value.flatMap { $0.isEmpty ? nil : $0 }
    }
}
