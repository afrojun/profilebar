import Foundation

enum ChromeWindowTitleMatcher {
    private static func profileLabel(profileName: String, personName: String?) -> String {
        guard
            let personName = personName?.trimmingCharacters(in: .whitespacesAndNewlines),
            !personName.isEmpty,
            personName.caseInsensitiveCompare(profileName) != .orderedSame
        else { return profileName }
        return "\(personName) (\(profileName))"
    }

    static func matches(windowTitle: String, profileName: String, personName: String?) -> Bool {
        let title = windowTitle.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let label = profileLabel(profileName: profileName, personName: personName).lowercased()
        return title == label
            || title.hasSuffix(" – \(label)")
            || title.hasSuffix(" — \(label)")
            || title.hasSuffix(" - \(label)")
    }

    static func matchesProfileMenuItem(title: String, profileName: String, personName: String?) -> Bool {
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let label = profileLabel(profileName: profileName, personName: personName)
        return title.caseInsensitiveCompare(profileName) == .orderedSame
            || title.caseInsensitiveCompare(label) == .orderedSame
    }

    /// Returns the profiles Chrome labels the same way as `profile`, including `profile`, in the
    /// order Chrome lists them in its Profiles menu: by profile name, then by profile directory.
    static func profilesSharingLabel(with profile: ChromeProfile, in profiles: [ChromeProfile]) -> [ChromeProfile] {
        let label = profileLabel(profileName: profile.name, personName: profile.personName)
        return profiles.filter {
            profileLabel(profileName: $0.name, personName: $0.personName).caseInsensitiveCompare(label)
                == .orderedSame
        }.sorted {
            let order = $0.name.localizedCompare($1.name)
            return order == .orderedSame ? $0.directory < $1.directory : order == .orderedAscending
        }
    }
}
