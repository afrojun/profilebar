import Foundation

enum NativeHostRegistration {
    static let productionHostName = "dev.afrojun.profilebar"
    static let developmentHostName = "dev.afrojun.profilebar.dev"
    static let storeExtensionID = "dhalfjnfoocnfpppmkpidbliccemicno"

    static func installForCurrentApp() throws {
        if Bundle.main.bundleIdentifier == "dev.afrojun.ProfileBar.dev" {
            guard let extensionID = ProcessInfo.processInfo.environment["PROFILEBAR_DEV_EXTENSION_ID"] else { return }
            try install(hostName: developmentHostName, extensionID: extensionID)
        } else {
            try install(hostName: productionHostName, extensionID: storeExtensionID)
        }
    }

    static func manifest(hostName: String, extensionID: String, helperPath: String) throws -> Data {
        guard extensionID.count == 32 && extensionID.allSatisfy({ ("a"..."p").contains(String($0)) }) else {
            throw ProfileBarError.message("The Chrome extension ID is invalid.")
        }
        return try JSONSerialization.data(
            withJSONObject: [
                "name": hostName,
                "description": "Open a Chrome URL in a selected profile with ProfileBar",
                "path": helperPath,
                "type": "stdio",
                "allowed_origins": ["chrome-extension://\(extensionID)/"],
            ], options: [.sortedKeys])
    }

    private static func install(hostName: String, extensionID: String) throws {
        let helperURL = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/ProfileBarNativeHost")
        guard FileManager.default.isExecutableFile(atPath: helperURL.path) else {
            throw ProfileBarError.message("ProfileBar's Chrome helper is missing.")
        }
        let manifestData = try manifest(hostName: hostName, extensionID: extensionID, helperPath: helperURL.path)
        let directory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Google/Chrome/NativeMessagingHosts")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try manifestData.write(to: directory.appendingPathComponent("\(hostName).json"), options: .atomic)
    }
}
