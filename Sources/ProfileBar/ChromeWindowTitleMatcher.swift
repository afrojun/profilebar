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

    /// Returns the positions of a profile's entries among Chrome's Profiles menu titles. Entries
    /// showing the profile's full label win; a bare profile name counts only when none does, so
    /// another profile shown by that name cannot shift the positions of same-labelled profiles.
    static func profileMenuItemIndices(titles: [String], profileName: String, personName: String?) -> [Int] {
        let label = profileLabel(profileName: profileName, personName: personName)
        func indices(matching name: String) -> [Int] {
            titles.indices.filter {
                titles[$0].trimmingCharacters(in: .whitespacesAndNewlines).caseInsensitiveCompare(name) == .orderedSame
            }
        }
        let labelled = indices(matching: label)
        return labelled.isEmpty ? indices(matching: profileName) : labelled
    }

    /// Returns the profiles Chrome labels the same way as `profile`, including `profile`, in the
    /// order Chrome lists them in its Profiles menu: by displayed label, then by profile directory.
    static func profilesSharingLabel(with profile: ChromeProfile, in profiles: [ChromeProfile]) -> [ChromeProfile] {
        let label = profileLabel(profileName: profile.name, personName: profile.personName)
        return profiles.filter {
            profileLabel(profileName: $0.name, personName: $0.personName).caseInsensitiveCompare(label)
                == .orderedSame
        }.sorted {
            let order = profileLabel(profileName: $0.name, personName: $0.personName)
                .localizedCompare(profileLabel(profileName: $1.name, personName: $1.personName))
            return order == .orderedSame ? $0.directory < $1.directory : order == .orderedAscending
        }
    }
}
