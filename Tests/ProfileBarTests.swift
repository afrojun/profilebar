import AppKit
import Carbon

func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else {
        FileHandle.standardError.write(Data("FAIL: \(message)\n".utf8))
        exit(1)
    }
}

@main
struct ProfileBarTests {
    static func main() {
        expect(
            ChromeWindowTitleMatcher.matches(
                windowTitle: "Calendar - Google Chrome – Taylor (Work)",
                profileName: "Work",
                personName: "Taylor"
            ),
            "a qualified work-profile window should match"
        )
        expect(
            ChromeWindowTitleMatcher.matches(
                windowTitle: "Image generation review - Google Chrome – Personal",
                profileName: "Personal",
                personName: "Personal"
            ),
            "a personal-profile window should match"
        )
        expect(
            !ChromeWindowTitleMatcher.matches(
                windowTitle: "Calendar - Google Chrome – Taylor (Side Project)",
                profileName: "Work",
                personName: "Taylor"
            ),
            "another profile must not match"
        )
        expect(
            !ChromeWindowTitleMatcher.matches(
                windowTitle: "A page mentioning Taylor (Work)",
                profileName: "Work",
                personName: "Taylor"
            ),
            "page content without Chrome's title separator must not match"
        )
        expect(
            ChromeWindowTitleMatcher.matchesProfileMenuItem(
                title: "Taylor (Work)",
                profileName: "Work",
                personName: "Taylor"
            ),
            "a qualified profile menu item should match"
        )
        expect(
            ChromeWindowTitleMatcher.matchesProfileMenuItem(
                title: "Personal",
                profileName: "Personal",
                personName: "Personal"
            ),
            "a plain profile menu item should match"
        )
        expect(
            !ChromeWindowTitleMatcher.matchesProfileMenuItem(
                title: "Taylor",
                profileName: "Work",
                personName: "Taylor"
            ),
            "a shared person name must not identify a profile"
        )
        expect(
            ChromeWindowTitleMatcher.matches(
                windowTitle: "  CALENDAR - GOOGLE CHROME — TAYLOR (WORK)  ",
                profileName: "Work",
                personName: "Taylor"
            ),
            "window matching should ignore case and surrounding whitespace"
        )
        expect(
            (try? ChromeProfile(directory: "Default", name: "Personal", personName: nil)) != nil,
            "a normal directory should be valid"
        )
        for directory in ["", ".", "..", "../Work", "Work/Profile", "Work\\Profile", "Work\0Profile"] {
            expect(
                (try? ChromeProfile(directory: directory, name: "Work", personName: nil)) == nil,
                "an unsafe directory must be rejected"
            )
        }

        let localState = try! JSONSerialization.data(withJSONObject: [
            "profile": [
                "info_cache": [
                    "Profile 2": ["name": "Work", "gaia_given_name": "Taylor"],
                    "Default": ["name": "", "shortcut_name": "Personal", "gaia_given_name": ""],
                    "Profile 1": [:],
                ]
            ]
        ])
        let profiles = try! ChromeProfileStore.parse(localState)
        expect(
            profiles.map(\.name) == ["Personal", "Profile 1", "Work"],
            "profiles should use name fallbacks and sort by display name"
        )
        expect(profiles[0].personName == nil, "an empty person name should be omitted")
        expect(profiles[2].personName == "Taylor", "a person name should be loaded")
        expect(
            (try? ChromeProfileStore.parse(Data("{}".utf8))) == nil,
            "missing profile data should be rejected"
        )
        expect(
            (try? ChromeProfileStore.parse(Data("not json".utf8))) == nil,
            "malformed profile data should be rejected"
        )
        let unsafeLocalState = try! JSONSerialization.data(withJSONObject: [
            "profile": ["info_cache": ["../Work": ["name": "Work"]]]
        ])
        expect(
            (try? ChromeProfileStore.parse(unsafeLocalState)) == nil,
            "an unsafe directory from Chrome data should be rejected"
        )

        let workProfile = try! ChromeProfile(directory: "Profile 2", name: "Work", personName: nil)
        let otherWorkProfile = try! ChromeProfile(directory: "Profile 3", name: "Work", personName: nil)
        expect(
            ChromeFocusedProfile.match(
                windowTitle: "Calendar - Google Chrome – Work", profiles: [workProfile]) == workProfile,
            "a unique focused Chrome window should identify its profile")
        expect(
            ChromeFocusedProfile.match(
                windowTitle: "Calendar - Google Chrome – Work",
                profiles: [workProfile, otherWorkProfile]) == nil,
            "an ambiguous profile label must leave all destinations visible")
        var openedURLs: [URL]?
        var openedGroup: TabGroupDetails?
        var groupedResult = true
        let bridge = ProfileBridge(
            loadProfiles: { [workProfile] },
            focusedProfile: { _ in workProfile },
            openURLs: { _, urls in openedURLs = urls },
            openGroup: { _, _, group, _ in
                openedGroup = group
                return groupedResult
            }
        )
        let listed = bridge.handle(["type": "listProfiles"])
        expect(listed["ok"] as? Bool == true, "the helper should list Chrome profiles")
        let listedProfiles = listed["profiles"] as? [[String: String]]
        expect(listedProfiles?.first?["directory"] == "Profile 2", "profiles should be identified by directory")
        expect(
            listed["focusedProfileDirectory"] as? String == "Profile 2",
            "a verified focused profile should be returned by directory")
        let invalidURL = bridge.handle([
            "type": "openURL", "profileDirectory": "Profile 2", "url": "file:///private/tmp/example",
        ])
        expect(invalidURL["error"] as? String == "invalid_request", "the helper should reject non-web URLs")
        expect(openedURLs == nil, "an invalid URL must not launch Chrome")
        let unknownProfile = bridge.handle([
            "type": "openURL", "profileDirectory": "Profile 3", "url": "https://example.com/",
        ])
        expect(unknownProfile["error"] as? String == "profile_not_found", "a stale profile must not launch Chrome")
        expect(openedURLs == nil, "an unknown profile must not launch Chrome")
        let opened = bridge.handle([
            "type": "openURL", "profileDirectory": "Profile 2", "url": "https://example.com/path",
        ])
        expect(opened["ok"] as? Bool == true, "a valid request should open the URL")
        expect(
            openedURLs?.map(\.absoluteString) == ["https://example.com/path"],
            "the selected URL should reach the launcher"
        )
        let invalidBatch = bridge.handle([
            "type": "openURLs", "profileDirectory": "Profile 2",
            "urls": ["https://example.com/first", "chrome://settings"],
        ])
        expect(invalidBatch["error"] as? String == "invalid_request", "one invalid URL must reject the whole batch")
        expect(openedURLs?.count == 1, "an invalid batch must not launch Chrome")
        let openedBatch = bridge.handle([
            "type": "openURLs", "profileDirectory": "Profile 2",
            "urls": ["https://example.com/first", "https://example.com/second"],
        ])
        expect(openedBatch["ok"] as? Bool == true, "a valid batch should open all URLs")
        expect(
            openedURLs?.map(\.absoluteString) == ["https://example.com/first", "https://example.com/second"],
            "the launcher should receive every URL in tab order"
        )
        let groupRequest: [String: Any] = [
            "type": "openGroup", "profileDirectory": "Profile 2",
            "urls": ["https://example.com/first", "https://example.com/second"],
            "group": ["title": "Research", "color": "blue", "collapsed": true],
        ]
        let untrustedGroup = bridge.handle(groupRequest)
        expect(
            untrustedGroup["error"] as? String == "invalid_request",
            "a caller without an extension origin cannot open a group")
        let grouped = bridge.handle(groupRequest, callerExtensionID: NativeHostRegistration.storeExtensionID)
        expect(
            grouped["ok"] as? Bool == true && grouped["grouped"] as? Bool == true, "a valid group should be recreated")
        expect(
            openedGroup?.title == "Research" && openedGroup?.color == "blue" && openedGroup?.collapsed == true,
            "group metadata should reach the destination")
        groupedResult = false
        let ungrouped = bridge.handle(groupRequest, callerExtensionID: NativeHostRegistration.storeExtensionID)
        expect(
            ungrouped["ok"] as? Bool == true && ungrouped["grouped"] as? Bool == false,
            "the native helper should report a URL-only fallback")
        var invalidGroup = groupRequest
        invalidGroup["group"] = ["title": "Research", "color": "not-a-color", "collapsed": true]
        expect(
            bridge.handle(invalidGroup, callerExtensionID: NativeHostRegistration.storeExtensionID)["error"] as? String
                == "invalid_request",
            "invalid group metadata must not be launched")

        func receiverPreferences(version: String, nativeAccess: Bool) -> Data {
            try! JSONSerialization.data(withJSONObject: [
                "extensions": [
                    "settings": [
                        NativeHostRegistration.storeExtensionID: [
                            "manifest": ["version": version],
                            "disable_reasons": [],
                            "active_permissions": ["api": nativeAccess ? ["nativeMessaging"] : []],
                        ]
                    ]
                ]
            ])
        }
        expect(
            GroupReceiverAvailability.supportsReceiver(
                receiverPreferences(version: "1.8.0", nativeAccess: true),
                extensionID: NativeHostRegistration.storeExtensionID), "a capable destination should receive groups")
        expect(
            !GroupReceiverAvailability.supportsReceiver(
                receiverPreferences(version: "1.7.0", nativeAccess: true),
                extensionID: NativeHostRegistration.storeExtensionID),
            "an older extension should use the URL-only fallback")
        expect(
            !GroupReceiverAvailability.supportsReceiver(
                receiverPreferences(version: "1.8.0", nativeAccess: false),
                extensionID: NativeHostRegistration.storeExtensionID),
            "a profile without native access should use the URL-only fallback")

        let relay = try! GroupRelay(payload: ["urls": ["https://example.com/"], "group": ["title": "Research"]])
        let relayFinished = DispatchSemaphore(value: 0)
        let relayState = NSLock()
        var relayCompleted = false
        DispatchQueue.global().async {
            defer { relayFinished.signal() }
            do {
                let claimed = try relay.awaitClaim(seconds: 2)
                let completed = try relay.awaitCompletion(seconds: 2)
                relayState.lock()
                relayCompleted = claimed && completed
                relayState.unlock()
            } catch {}
        }
        let claim = try! GroupRelay.request(token: relay.token, message: ["type": "claim"])
        expect((claim["urls"] as? [String]) == ["https://example.com/"], "the receiver should get the pending URLs")
        let completion = try! GroupRelay.request(token: relay.token, message: ["type": "complete", "ok": true])
        expect(completion["ok"] as? Bool == true, "the receiver should get a completion acknowledgement")
        expect(relayFinished.wait(timeout: .now() + 2) == .success, "the source should finish the handoff")
        relayState.lock()
        let didComplete = relayCompleted
        relayState.unlock()
        expect(didComplete, "the source should observe the receiver's claim and completion")

        let expiredRelay = try! GroupRelay(payload: [:])
        expect(try! !expiredRelay.awaitClaim(seconds: 0), "an absent receiver should allow a URL-only fallback")
        expiredRelay.closeListening()
        expect(
            (try? GroupRelay.request(token: expiredRelay.token, message: ["type": "claim"])) == nil,
            "a receiver arriving after fallback must not claim the group")

        let manifest = try! NativeHostRegistration.manifest(
            hostName: NativeHostRegistration.productionHostName,
            extensionID: NativeHostRegistration.storeExtensionID,
            helperPath: "/Applications/ProfileBar.app/Contents/MacOS/ProfileBarNativeHost"
        )
        let manifestObject = try! JSONSerialization.jsonObject(with: manifest) as! [String: Any]
        expect(
            (manifestObject["allowed_origins"] as? [String]) == [
                "chrome-extension://dhalfjnfoocnfpppmkpidbliccemicno/"
            ],
            "only the published extension should reach the production helper"
        )

        let hotKey = ProfileHotKey(
            keyCode: 18,
            modifiers: UInt32(controlKey | optionKey),
            keyLabel: "1"
        )
        expect(hotKey.displayName == "⌃⌥1", "a shortcut should use standard macOS modifier symbols")
        let shiftedNumber = ProfileHotKey(
            keyCode: 25,
            modifiers: UInt32(controlKey | optionKey | shiftKey),
            keyLabel: "9"
        )
        expect(
            shiftedNumber.displayName == "⌃⌥⇧9",
            "a shifted shortcut should show the physical key"
        )

        let suiteName = "ProfileBarTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let preferences = ProfileShortcutPreferences(defaults: defaults)
        expect(preferences.isProfileVisible("Default"), "profile icons should be visible by default")
        defaults.set(false, forKey: "showProfileIcons")
        expect(!preferences.isProfileVisible("Default"), "the old visibility setting should remain the default")
        preferences.setProfileVisible(true, for: "Profile 1")
        preferences.setShortcut(hotKey, for: "Profile 1")
        expect(preferences.isProfileVisible("Profile 1"), "profile visibility should persist by directory")
        expect(!preferences.isProfileVisible("Profile 2"), "an unset profile should keep the old default")
        expect(preferences.shortcuts["Profile 1"] == hotKey, "shortcuts should persist by profile directory")
        preferences.setShortcut(nil, for: "Profile 1")
        expect(preferences.shortcuts["Profile 1"] == nil, "clearing a shortcut should remove it")
        defaults.set(Data("not json".utf8), forKey: "profileShortcuts")
        expect(preferences.shortcuts.isEmpty, "corrupt shortcut data should fall back to no shortcuts")
        defaults.set(true, forKey: "showProfileIcons")
        preferences.setProfileVisible(false, for: "Profile 3")
        expect(!preferences.isProfileVisible("Profile 3"), "a profile setting should override the old global setting")

        let symbol = ProfileBarSymbol.image()
        expect(symbol.size == NSSize(width: 18, height: 18), "menu-bar symbol should use the native status-item size")
        expect(symbol.isTemplate, "menu-bar symbol should adapt to the menu-bar appearance")
        expect(symbol.tiffRepresentation != nil, "menu-bar symbol should render")
        let devSymbol = ProfileBarSymbol.image(isDevelopment: true)
        expect(devSymbol.size == symbol.size, "development symbol should keep the menu-bar size")
        expect(devSymbol.isTemplate, "development symbol should adapt to the menu-bar appearance")
        let regularPixels = NSBitmapImageRep(data: symbol.tiffRepresentation!)!
        let devPixels = NSBitmapImageRep(data: devSymbol.tiffRepresentation!)!
        let centerX = regularPixels.pixelsWide / 2
        let centerY = regularPixels.pixelsHigh / 2
        for x in [3, centerX, 15] {
            expect(
                regularPixels.colorAt(x: x, y: centerY)!.alphaComponent > 0.5,
                "regular symbol should fill all three panels"
            )
            expect(
                devPixels.colorAt(x: x, y: centerY)!.alphaComponent < 0.5,
                "development symbol should leave all three panels hollow"
            )
        }
        for x in [1, 6, 16] {
            expect(
                devPixels.colorAt(x: x, y: centerY)!.alphaComponent > 0.5,
                "development symbol should show all three outlines"
            )
        }

        expect(AppVersion("v1.10.0")! > AppVersion("1.9.9")!, "version comparison should use numeric parts")
        expect(AppVersion("1.0")! == AppVersion("1.0.0")!, "missing version parts should equal zero")
        expect(AppVersion("1.0-beta") == nil, "non-numeric release versions should be rejected")
        expect(AppVersion("1.-1.0") == nil, "negative release versions should be rejected")

        let now = Date(timeIntervalSinceReferenceDate: 1_000_000)
        expect(
            UpdateCheckPolicy.delay(lastCheck: nil, now: now) == 10,
            "the first update check should wait briefly after launch"
        )
        expect(
            UpdateCheckPolicy.delay(lastCheck: now.addingTimeInterval(-25 * 60 * 60), now: now) == 10,
            "an overdue update check should wait briefly after launch"
        )
        expect(
            UpdateCheckPolicy.delay(lastCheck: now.addingTimeInterval(-23 * 60 * 60), now: now) == 60 * 60,
            "a recent update check should wait until the next day"
        )
        expect(
            UpdateCheckPolicy.delay(lastCheck: now.addingTimeInterval(60 * 60), now: now) == 24 * 60 * 60,
            "a future check date should not postpone updates for more than a day"
        )

        let release = try! JSONDecoder().decode(
            GitHubRelease.self,
            from: Data(
                #"{"tag_name":"v1.1.0","html_url":"https://github.com/afrojun/profilebar/releases/tag/v1.1.0"}"#.utf8)
        )
        expect(release.tagName == "v1.1.0", "the GitHub release tag should decode")
        expect(release.pageURL.host == "github.com", "the GitHub release page should decode")
        print("PASS: ProfileBar tests")
    }
}
