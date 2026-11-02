import Foundation

/// The link-routing rules and settings shared by every Chrome profile. See docs/link-routing-design.md.
struct LinkRoutingSettings: Codable, Equatable {
    struct Sources: Codable, Equatable {
        var otherApps: Bool
        var webPages: Bool
    }

    static let maximumRuleCount = 500
    /// Routing these hosts would break sign-in in other profiles. extension/routing-rules.js keeps the same list.
    static let signInHosts = [
        "accounts.google.com", "login.microsoftonline.com", "login.live.com", "appleid.apple.com", "okta.com",
    ]

    var version = 1
    var routeFrom = Sources(otherApps: true, webPages: true)
    var rules: [LinkRule] = []
    /// Where links from other apps that match no rule open. Nil leaves them where Chrome opens them.
    var fallbackProfileDirectory: String?

    /// Returns the settings with hosts lowercased and unused rule fields removed, or the first problem found.
    func validated() throws -> LinkRoutingSettings {
        guard version == 1 else { throw LinkRoutingError(.unsupportedVersion) }
        guard rules.count <= Self.maximumRuleCount else { throw LinkRoutingError(.tooManyRules) }
        if let fallbackProfileDirectory, !ChromeProfile.isValidDirectory(fallbackProfileDirectory) {
            throw LinkRoutingError(.invalidFallbackProfile)
        }
        var result = self
        result.rules = try rules.enumerated().map { index, rule in
            do throws(LinkRoutingError.Reason) {
                return try rule.validated()
            } catch {
                throw LinkRoutingError(error, ruleIndex: index)
            }
        }
        return result
    }
}

struct LinkRule: Codable, Equatable {
    enum Kind: String, Codable {
        /// Matches the host and its subdomains, then an optional path prefix.
        case host
        /// Matches any URL that contains the text.
        case contains
    }

    var id: String
    var kind: Kind
    var host: String?
    var pathPrefix: String?
    var text: String?
    var profileDirectory: String

    fileprivate func validated() throws(LinkRoutingError.Reason) -> LinkRule {
        guard (1...64).contains(id.count), id.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" }) else {
            throw .invalidID
        }
        guard ChromeProfile.isValidDirectory(profileDirectory) else { throw .invalidProfile }
        switch kind {
        case .host:
            var host = (host ?? "").lowercased()
            if host.hasSuffix(".") { host.removeLast() }
            guard Self.isValidHost(host) else { throw .invalidHost }
            guard !LinkRoutingSettings.isSignInHost(host) else { throw .signInHost }
            let pathPrefix = pathPrefix ?? ""
            // Chrome matches a path with a pattern, and limits how large a compiled pattern can be.
            guard
                pathPrefix.isEmpty
                    || (pathPrefix.hasPrefix("/") && pathPrefix.count <= 256 && Self.isFilterText(pathPrefix))
            else {
                throw .invalidPath
            }
            return LinkRule(
                id: id, kind: kind, host: host, pathPrefix: pathPrefix, text: nil, profileDirectory: profileDirectory)
        case .contains:
            let text = text ?? ""
            guard Self.isFilterText(text) else { throw .invalidText }
            guard !LinkRoutingSettings.signInHosts.contains(where: { text.lowercased().contains($0) }) else {
                throw .signInHost
            }
            return LinkRule(
                id: id, kind: kind, host: nil, pathPrefix: nil, text: text, profileDirectory: profileDirectory)
        }
    }

    private static func isValidHost(_ host: String) -> Bool {
        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        return (1...253).contains(host.count)
            && labels.allSatisfy { label in
                (1...63).contains(label.count)
                    && label.allSatisfy { ("a"..."z").contains($0) || ("0"..."9").contains($0) || $0 == "-" }
                    && label.first != "-" && label.last != "-"
            }
    }

    /// Chrome's request filters accept only ASCII and treat `*`, `|`, and `^` as patterns. URLs never contain
    /// whitespace.
    private static func isFilterText(_ text: String) -> Bool {
        (1...1024).contains(text.count)
            && text.allSatisfy { $0.isASCII && !$0.isWhitespace && !"*|^".contains($0) }
    }
}

extension LinkRoutingSettings {
    /// Picks the rule that routes the link, as `RoutingRules.winningRule` in extension/routing-rules.js does. Both
    /// are tested against extension/test/routing-cases.json. Settings uses this to explain where a link would go.
    func winningRule(for link: String) -> LinkRule? {
        // Re-parsing the resolved URL also gives international hosts their punycode form, as Chrome does.
        guard let resolved = Self.resolvingDotSegments(link), let url = URL(string: resolved.absoluteString),
            let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme),
            let host = url.host(percentEncoded: true)?.lowercased(), !host.isEmpty,
            !Self.isSignInHost(host)
        else { return nil }
        let pathText = url.path(percentEncoded: true)
        let path = (pathText.isEmpty ? "/" : pathText).lowercased()
        let defaultPort = scheme == "https" ? 443 : 80
        let port = url.port.map { $0 == defaultPort ? "" : ":\($0)" } ?? ""
        let query = url.query(percentEncoded: true).map { "?\($0)" } ?? ""
        let href = "\(scheme)://\(host)\(port)\(path)\(query)".lowercased()

        let ranked = rules.enumerated().sorted { a, b in
            let order = Self.compareSpecificity(a.element, b.element)
            return order == 0 ? a.offset < b.offset : order < 0
        }
        return ranked.map(\.element).first { rule in
            switch rule.kind {
            case .host:
                let ruleHost = rule.host ?? ""
                return (host == ruleHost || host.hasSuffix(".\(ruleHost)"))
                    && path.hasPrefix((rule.pathPrefix ?? "").lowercased())
            case .contains:
                return href.contains((rule.text ?? "").lowercased())
            }
        }
    }

    /// Resolves `.` and `..` path segments, including their `%2e` forms, as Chrome does. `..` never climbs above the
    /// root. Foundation leaves the encoded forms and a `..` above the root in place.
    private static func resolvingDotSegments(_ link: String) -> URL? {
        guard var components = URLComponents(string: link) else { return nil }
        var segments: [Substring] = []
        let path = components.percentEncodedPath.split(separator: "/", omittingEmptySubsequences: false).dropFirst()
        for (index, segment) in path.enumerated() {
            let isLast = index == path.count - 1
            switch segment.replacingOccurrences(of: "%2e", with: ".", options: .caseInsensitive) {
            case ".":
                if isLast { segments.append("") }
            case "..":
                _ = segments.popLast()
                if isLast { segments.append("") }
            default:
                segments.append(segment)
            }
        }
        if !components.percentEncodedPath.isEmpty {
            components.percentEncodedPath = "/" + segments.joined(separator: "/")
        }
        return components.url
    }

    static func isSignInHost(_ host: String) -> Bool {
        signInHosts.contains { host == $0 || host.hasSuffix(".\($0)") }
    }

    /// Site rules come first, then longer hosts, paths, and text.
    private static func compareSpecificity(_ a: LinkRule, _ b: LinkRule) -> Int {
        if a.kind != b.kind { return a.kind == .host ? -1 : 1 }
        if a.kind == .host {
            let hosts = (b.host ?? "").count - (a.host ?? "").count
            return hosts != 0 ? hosts : (b.pathPrefix ?? "").count - (a.pathPrefix ?? "").count
        }
        return (b.text ?? "").count - (a.text ?? "").count
    }
}

struct LinkRoutingError: Error, Equatable {
    enum Reason: String, Error {
        case unsupportedVersion = "unsupported_version"
        case tooManyRules = "too_many_rules"
        case invalidID = "invalid_id"
        case invalidHost = "invalid_host"
        case signInHost = "sign_in_host"
        case invalidPath = "invalid_path"
        case invalidText = "invalid_text"
        case invalidProfile = "invalid_profile"
        case invalidFallbackProfile = "invalid_fallback_profile"
    }

    let reason: Reason
    var ruleIndex: Int?

    init(_ reason: Reason, ruleIndex: Int? = nil) {
        self.reason = reason
        self.ruleIndex = ruleIndex
    }

    var message: String {
        switch reason {
        case .unsupportedVersion: "A newer ProfileBar saved these rules. Update ProfileBar to change them."
        case .tooManyRules: "ProfileBar can keep up to \(LinkRoutingSettings.maximumRuleCount) rules."
        case .invalidID: "A rule is missing its ID. Delete it and add it again."
        case .invalidHost: "Enter a site such as example.com or github.com/team."
        case .signInHost: "Sign-in sites can’t be routed, because every profile needs them to sign in."
        case .invalidPath:
            "Enter a site path up to 256 characters that starts with / and uses only ASCII, without spaces, *, |, or ^."
        case .invalidText: "Enter the text to look for using only ASCII, without spaces, *, |, or ^."
        case .invalidProfile: "Choose a profile for each rule."
        case .invalidFallbackProfile: "Choose where other links from apps open."
        }
    }
}

extension LinkRoutingSettings {
    init(jsonObject: Any) throws {
        self = try JSONDecoder().decode(Self.self, from: JSONSerialization.data(withJSONObject: jsonObject))
    }

    func jsonObject() throws -> Any {
        try JSONSerialization.jsonObject(with: JSONEncoder().encode(self))
    }
}

/// ProfileBar Dev keeps its own rules and relay sockets, so testing never affects the installed app.
enum ProfileBarVariant {
    static var folderName: String {
        Bundle.main.bundleIdentifier == "dev.afrojun.ProfileBar.dev" ? "ProfileBar Dev" : "ProfileBar"
    }
}

enum LinkRoutingStore {
    static var fileURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support", isDirectory: true)
            .appendingPathComponent(ProfileBarVariant.folderName, isDirectory: true)
            .appendingPathComponent("link-routing.json")
    }

    static func unreadableMessage(for error: Error) -> String {
        (error as? LinkRoutingError)?.message ?? "ProfileBar could not read the link-routing rules."
    }

    static func load(from url: URL = fileURL) throws -> LinkRoutingSettings {
        guard FileManager.default.fileExists(atPath: url.path) else { return LinkRoutingSettings() }
        return try JSONDecoder().decode(LinkRoutingSettings.self, from: Data(contentsOf: url)).validated()
    }

    static func save(_ settings: LinkRoutingSettings, to url: URL = fileURL) throws {
        let validSettings = try settings.validated()
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(validSettings).write(to: url, options: .atomic)
    }
}
