import AppKit
import ApplicationServices
import ServiceManagement

@MainActor
final class ProfileBarAppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var profileItems: [NSStatusItem] = []
    private var utilityItem: NSStatusItem!
    private var profiles: [ChromeProfile] = []
    private var profileError: String?
    private let preferences = ProfileShortcutPreferences()
    private lazy var hotKeyRegistrar = GlobalHotKeyRegistrar { [weak self] profile in
        self?.activate(profile)
    }
    private let updateChecker = UpdateChecker()
    private var settingsWindow: SettingsWindowController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        utilityItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        utilityItem.button?.image = ProfileBarSymbol.image(
            isDevelopment: Bundle.main.bundleIdentifier?.hasSuffix(".dev") == true)
        utilityItem.button?.setAccessibilityLabel("ProfileBar settings")

        let menu = NSMenu()
        menu.delegate = self
        utilityItem.menu = menu
        reloadProfiles(rebuild: true)
        fillUtilityMenu(menu)
        updateChecker.start()
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        reloadProfiles()
        fillUtilityMenu(menu)
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        if settingsWindow?.window?.isVisible == true {
            settingsWindow?.refresh()
        }
    }

    private func reloadProfiles(rebuild: Bool = false) {
        do {
            let loaded = try ChromeProfileStore.load()
            let changed = loaded != profiles
            profiles = loaded
            profileError = nil
            if changed || rebuild {
                rebuildProfileItems()
                registerHotKeys()
            }
        } catch {
            let changed = !profiles.isEmpty || profileError != error.localizedDescription
            profiles = []
            profileError = error.localizedDescription
            if changed || rebuild {
                rebuildProfileItems()
                registerHotKeys()
            }
        }

        if settingsWindow?.window?.isVisible == true {
            settingsWindow?.refresh()
        }
    }

    private func rebuildProfileItems() {
        for item in profileItems {
            NSStatusBar.system.removeStatusItem(item)
        }
        let visibleProfiles = profiles.filter { preferences.isProfileVisible($0.directory) }
        // AppKit adds each new item to the left of the last one.
        profileItems = visibleProfiles.reversed().map(makeStatusItem)
    }

    private func registerHotKeys() {
        _ = hotKeyRegistrar.register(profiles: profiles, shortcuts: preferences.shortcuts)
    }

    private func makeStatusItem(for profile: ChromeProfile) -> NSStatusItem {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        guard let button = item.button else { return item }
        button.image = ProfileAvatarRenderer.image(for: profile)
        button.imagePosition = .imageOnly
        button.toolTip = "Switch to or open \(profile.name)"
        button.setAccessibilityLabel("Switch to \(profile.name) Chrome profile")
        button.identifier = NSUserInterfaceItemIdentifier(profile.directory)
        button.target = self
        button.action = #selector(selectProfile(_:))
        button.sendAction(on: .leftMouseUp)
        return item
    }

    private func fillUtilityMenu(_ menu: NSMenu) {
        menu.removeAllItems()
        if let profileError {
            let error = NSMenuItem(title: profileError, action: nil, keyEquivalent: "")
            error.isEnabled = false
            menu.addItem(error)
            menu.addItem(.separator())
        } else if !AXIsProcessTrusted() {
            let access = NSMenuItem(
                title: "Accessibility Access Needed…", action: #selector(openAccessibilitySettings), keyEquivalent: "")
            access.target = self
            menu.addItem(access)
            menu.addItem(.separator())
        }

        let settings = NSMenuItem(title: "Settings…", action: #selector(openSettings), keyEquivalent: ",")
        settings.target = self
        menu.addItem(settings)

        let refresh = NSMenuItem(title: "Refresh Profiles", action: #selector(refreshProfiles), keyEquivalent: "r")
        refresh.target = self
        menu.addItem(refresh)

        let updates = NSMenuItem(title: "Check for Updates…", action: #selector(checkForUpdates), keyEquivalent: "")
        updates.target = self
        updates.isEnabled = !updateChecker.isChecking
        menu.addItem(updates)

        menu.addItem(.separator())
        let quit = NSMenuItem(
            title: "Quit ProfileBar", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quit)
    }

    @objc private func selectProfile(_ sender: NSStatusBarButton) {
        guard
            let directory = sender.identifier?.rawValue,
            let profile = profiles.first(where: { $0.directory == directory })
        else { return }
        activate(profile)
    }

    @objc private func refreshProfiles() {
        reloadProfiles(rebuild: true)
        if let menu = utilityItem.menu { fillUtilityMenu(menu) }
    }

    @objc private func checkForUpdates() {
        updateChecker.checkNow()
    }

    @objc private func openSettings() {
        reloadProfiles()
        if settingsWindow == nil {
            settingsWindow = SettingsWindowController(actions: settingsActions)
        }
        settingsWindow?.present()
    }

    private var settingsActions: SettingsActions {
        SettingsActions(
            snapshot: { [unowned self] in
                settingsSnapshot
            },
            setShortcut: { [unowned self] profile, shortcut in
                setShortcut(shortcut, for: profile)
            },
            setProfileVisible: { [unowned self] profile, isVisible in
                setProfileVisible(isVisible, for: profile)
            },
            setLaunchAtLogin: { [unowned self] isEnabled in
                setLaunchAtLogin(isEnabled)
            },
            openAccessibilitySettings: { [unowned self] in
                openAccessibilitySettings()
            }
        )
    }

    private var settingsSnapshot: SettingsSnapshot {
        let profileSettings = profiles.map {
            ProfileSetting(
                profile: $0,
                shortcut: preferences.shortcuts[$0.directory],
                isVisible: preferences.isProfileVisible($0.directory)
            )
        }
        return SettingsSnapshot(
            profiles: profileSettings,
            profileError: profileError,
            launchAtLogin: launchAtLoginStatus,
            hasAccessibilityAccess: AXIsProcessTrusted()
        )
    }

    private func setShortcut(_ shortcut: ProfileHotKey?, for profile: ChromeProfile) -> String? {
        if let shortcut,
            preferences.shortcuts.contains(where: { directory, assigned in
                directory != profile.directory && assigned == shortcut
            })
        {
            return "Already assigned to another profile."
        }

        let previous = preferences.shortcuts[profile.directory]
        preferences.setShortcut(shortcut, for: profile.directory)
        let failures = hotKeyRegistrar.register(profiles: profiles, shortcuts: preferences.shortcuts)
        guard !failures.contains(profile.directory) else {
            preferences.setShortcut(previous, for: profile.directory)
            registerHotKeys()
            return "Already used by macOS or another app."
        }
        return nil
    }

    private func setProfileVisible(_ isVisible: Bool, for profile: ChromeProfile) {
        preferences.setProfileVisible(isVisible, for: profile.directory)
        rebuildProfileItems()
    }

    private func setLaunchAtLogin(_ isEnabled: Bool) -> String? {
        let service = SMAppService.mainApp
        do {
            if isEnabled {
                if service.status != .enabled && service.status != .requiresApproval {
                    try service.register()
                }
                if service.status == .requiresApproval { SMAppService.openSystemSettingsLoginItems() }
            } else if service.status == .enabled || service.status == .requiresApproval {
                try service.unregister()
            }
            return nil
        } catch {
            return "Could not change this setting: \(error.localizedDescription)"
        }
    }

    private var launchAtLoginStatus: LaunchAtLoginStatus {
        switch SMAppService.mainApp.status {
        case .enabled: .on
        case .requiresApproval: .needsApproval
        default: .off
        }
    }

    private func activate(_ profile: ChromeProfile) {
        do {
            try ChromeProfileActivator.activate(profile)
        } catch ProfileBarError.accessibilityAccessRequired {
            showAccessibilityHelp()
        } catch {
            show(error: error.localizedDescription)
        }
    }

    private func showAccessibilityHelp() {
        NSApp.activate()
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.icon = NSImage(systemSymbolName: "person.2.circle.fill", accessibilityDescription: "ProfileBar")
        alert.messageText = "Accessibility access needed"
        alert.informativeText = "Allow ProfileBar to control Chrome, then try the profile again."
        alert.addButton(withTitle: "Open System Settings")
        alert.addButton(withTitle: "Not Now")
        if alert.runModal() == .alertFirstButtonReturn {
            openAccessibilitySettings()
        }
    }

    @objc private func openAccessibilitySettings() {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
        let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!
        NSWorkspace.shared.open(url)
    }

    private func show(error: String) {
        NSApp.activate()
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.icon = NSImage(systemSymbolName: "person.2.circle.fill", accessibilityDescription: "ProfileBar")
        alert.messageText = "ProfileBar"
        alert.informativeText = error
        alert.runModal()
    }
}

if CommandLine.arguments.contains("--check-accessibility") {
    if AXIsProcessTrusted() {
        print("PASS: ProfileBar is trusted for Accessibility")
        exit(0)
    } else {
        FileHandle.standardError.write(Data("FAIL: ProfileBar is not trusted for Accessibility\n".utf8))
        exit(1)
    }
}

MainActor.assumeIsolated {
    let application = NSApplication.shared
    let delegate = ProfileBarAppDelegate()
    application.delegate = delegate
    application.run()
}
