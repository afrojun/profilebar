import AppKit

enum LaunchAtLoginStatus {
    case off
    case on
    case needsApproval

    var isOn: Bool { self != .off }

    var detail: String {
        switch self {
        case .off, .on:
            "Open ProfileBar when you sign in."
        case .needsApproval:
            "Needs approval in System Settings → General → Login Items."
        }
    }
}

struct ProfileSetting {
    let profile: ChromeProfile
    let shortcut: ProfileHotKey?
    let isVisible: Bool
}

struct SettingsSnapshot {
    let profiles: [ProfileSetting]
    let profileError: String?
    let launchAtLogin: LaunchAtLoginStatus
    let hasAccessibilityAccess: Bool
}

struct SettingsActions {
    let snapshot: () -> SettingsSnapshot
    let setShortcut: (ChromeProfile, ProfileHotKey?) -> String?
    let setProfileVisible: (ChromeProfile, Bool) -> Void
    let setLaunchAtLogin: (Bool) -> String?
    let openAccessibilitySettings: () -> Void
}

@MainActor
final class SettingsWindowController: NSWindowController {
    private static let websiteURL = URL(string: "https://afrojun.dev/profilebar/")!
    private static let moveTabsGuideURL = URL(string: "https://afrojun.dev/profilebar/#move-tabs")!
    private static let extensionURL = URL(
        string: "https://chromewebstore.google.com/detail/instant-copy-url/dhalfjnfoocnfpppmkpidbliccemicno")!
    private static let repositoryURL = URL(string: "https://github.com/afrojun/profilebar")!
    private static let helpURL = repositoryURL.appending(path: "issues/new/choose")

    private let actions: SettingsActions
    private var launchDetail: NSTextField?

    init(actions: SettingsActions) {
        self.actions = actions
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 540, height: 380),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = Self.appName
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 500, height: 320)
        super.init(window: window)
        window.center()
        refresh()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func present() {
        refresh()
        NSApp.activate()
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
    }

    func refresh() {
        let snapshot = actions.snapshot()
        window?.contentView = makeContentView(snapshot)
        let height = max(480, 350 + 50 * snapshot.profiles.count)
        window?.setContentSize(NSSize(width: 540, height: height))
    }

    private func makeContentView(_ snapshot: SettingsSnapshot) -> NSView {
        let content = NSView()
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(stack)

        let intro = NSTextField(
            wrappingLabelWithString: "Choose which profiles appear in the menu bar and set a shortcut for each one.")
        intro.textColor = .secondaryLabelColor
        stack.addArrangedSubview(intro)
        intro.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true

        stack.addArrangedSubview(Self.heading("Profiles"))
        if snapshot.profiles.isEmpty {
            let empty = NSTextField(labelWithString: snapshot.profileError ?? "No Chrome profiles were found.")
            empty.textColor = snapshot.profileError == nil ? .secondaryLabelColor : .systemRed
            stack.addArrangedSubview(empty)
        } else {
            for item in snapshot.profiles {
                let row = ProfileSettingsRow(
                    item: item,
                    setShortcut: actions.setShortcut,
                    setVisible: actions.setProfileVisible
                )
                stack.addArrangedSubview(row)
                row.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
            }
        }

        let separator = NSBox()
        separator.boxType = .separator
        stack.addArrangedSubview(separator)
        separator.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true

        stack.addArrangedSubview(Self.heading("General"))
        let launch = makeLaunchRow(snapshot.launchAtLogin)
        stack.addArrangedSubview(launch)
        launch.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true

        let access = makeAccessibilityRow(snapshot.hasAccessibilityAccess)
        stack.addArrangedSubview(access)
        access.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true

        let moveTabsSeparator = NSBox()
        moveTabsSeparator.boxType = .separator
        stack.addArrangedSubview(moveTabsSeparator)
        moveTabsSeparator.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true

        let moveTabs = makeMoveTabsSection()
        stack.addArrangedSubview(moveTabs)
        moveTabs.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true

        let footerSeparator = NSBox()
        footerSeparator.boxType = .separator
        stack.addArrangedSubview(footerSeparator)
        footerSeparator.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true

        let footer = makeFooter()
        stack.addArrangedSubview(footer)
        footer.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 22),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: content.bottomAnchor, constant: -22),
        ])
        return content
    }

    private func makeLaunchRow(_ status: LaunchAtLoginStatus) -> NSView {
        let toggle = NSSwitch()
        toggle.state = status.isOn ? .on : .off
        toggle.target = self
        toggle.action = #selector(changeLaunchAtLogin(_:))
        toggle.setAccessibilityLabel("Start ProfileBar at login")

        let detail = Self.detail(status.detail)
        launchDetail = detail
        return Self.settingRow(title: "Start at login", detail: detail, controls: [toggle])
    }

    private func makeAccessibilityRow(_ hasAccess: Bool) -> NSView {
        let open = NSButton(
            title: hasAccess ? "Open Settings…" : "Grant Access…", target: self,
            action: #selector(openAccessibilitySettings))
        open.bezelStyle = .rounded

        let check = NSButton(title: "Check Again", target: self, action: #selector(checkAccessibility))
        check.bezelStyle = .rounded
        check.isHidden = hasAccess

        let detail = Self.detail(hasAccess ? "Allowed" : "Required to switch to an open Chrome profile.")
        detail.textColor = hasAccess ? .secondaryLabelColor : .systemOrange
        return Self.settingRow(title: "Accessibility", detail: detail, controls: [check, open])
    }

    private func makeMoveTabsSection() -> NSView {
        let description = Self.detail(
            "Move a page to another Chrome profile from the Instant Copy URL right-click menu.")
        let extensionLink = linkButton("Get Instant Copy URL", action: #selector(openExtensionStore))
        let guideLink = linkButton("How it works", action: #selector(openMoveTabsGuide))
        let links = NSStackView(views: [extensionLink, guideLink])
        links.orientation = .horizontal
        links.spacing = 16

        let section = NSStackView(views: [Self.heading("Move tabs between profiles"), description, links])
        section.orientation = .vertical
        section.alignment = .leading
        section.spacing = 6
        return section
    }

    @objc private func changeLaunchAtLogin(_ sender: NSSwitch) {
        if let error = actions.setLaunchAtLogin(sender.state == .on) {
            launchDetail?.stringValue = error
            launchDetail?.textColor = .systemRed
            sender.state = sender.state == .on ? .off : .on
            return
        }
        refresh()
    }

    @objc private func openAccessibilitySettings() {
        actions.openAccessibilitySettings()
    }

    @objc private func checkAccessibility() {
        refresh()
    }

    private func makeFooter() -> NSView {
        let version = NSTextField(labelWithString: "\(Self.appName) \(Self.version)")
        version.font = .systemFont(ofSize: NSFont.smallSystemFontSize)
        version.textColor = .secondaryLabelColor
        version.isSelectable = true

        let spacer = NSView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)

        let about = linkButton("About", action: #selector(showAbout))
        let help = linkButton("Help & Feedback", action: #selector(openHelp))
        let source = linkButton("View on GitHub", action: #selector(openRepository))

        let footer = NSStackView(views: [version, spacer, about, help, source])
        footer.orientation = .horizontal
        footer.alignment = .centerY
        footer.spacing = 12
        return footer
    }

    @objc private func showAbout() {
        let credits = NSMutableAttributedString(string: "ProfileBar website")
        credits.addAttribute(.link, value: Self.websiteURL, range: NSRange(location: 0, length: credits.length))
        NSApp.orderFrontStandardAboutPanel(options: [.credits: credits])
    }

    @objc private func openHelp() {
        NSWorkspace.shared.open(Self.helpURL)
    }

    @objc private func openExtensionStore() {
        NSWorkspace.shared.open(Self.extensionURL)
    }

    @objc private func openMoveTabsGuide() {
        NSWorkspace.shared.open(Self.moveTabsGuideURL)
    }

    @objc private func openRepository() {
        NSWorkspace.shared.open(Self.repositoryURL)
    }

    private static func heading(_ title: String) -> NSTextField {
        let label = NSTextField(labelWithString: title)
        label.font = .systemFont(ofSize: NSFont.systemFontSize, weight: .semibold)
        return label
    }

    private static func detail(_ text: String) -> NSTextField {
        let label = NSTextField(wrappingLabelWithString: text)
        label.font = .systemFont(ofSize: NSFont.smallSystemFontSize)
        label.textColor = .secondaryLabelColor
        return label
    }

    private func linkButton(_ title: String, action: Selector) -> NSButton {
        let button = NSButton(title: title, target: self, action: action)
        button.isBordered = false
        button.font = .systemFont(ofSize: NSFont.smallSystemFontSize)
        button.contentTintColor = .linkColor
        return button
    }

    private static var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "Unknown"
    }

    private static var appName: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "ProfileBar"
    }

    private static func settingRow(title: String, detail: NSTextField, controls: [NSView]) -> NSView {
        let titleLabel = NSTextField(labelWithString: title)
        let labels = NSStackView(views: [titleLabel, detail])
        labels.orientation = .vertical
        labels.alignment = .leading
        labels.spacing = 2
        labels.setContentHuggingPriority(.defaultLow, for: .horizontal)

        let controlStack = NSStackView(views: controls)
        controlStack.orientation = .horizontal
        controlStack.alignment = .centerY
        controlStack.spacing = 8

        let row = NSStackView(views: [labels, controlStack])
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 12
        return row
    }
}

@MainActor
private final class ProfileSettingsRow: NSView {
    init(
        item: ProfileSetting,
        setShortcut: @escaping (ChromeProfile, ProfileHotKey?) -> String?,
        setVisible: @escaping (ChromeProfile, Bool) -> Void
    ) {
        super.init(frame: .zero)

        let avatar = NSImageView(image: ProfileAvatarRenderer.image(for: item.profile, size: 28))
        avatar.imageScaling = .scaleProportionallyUpOrDown
        avatar.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            avatar.widthAnchor.constraint(equalToConstant: 28),
            avatar.heightAnchor.constraint(equalToConstant: 28),
        ])

        let name = NSTextField(labelWithString: item.profile.name)
        name.lineBreakMode = .byTruncatingTail
        name.translatesAutoresizingMaskIntoConstraints = false
        name.widthAnchor.constraint(equalToConstant: 132).isActive = true

        let feedback = NSTextField(labelWithString: "")
        feedback.font = .systemFont(ofSize: NSFont.smallSystemFontSize)
        feedback.textColor = .secondaryLabelColor
        feedback.isHidden = true

        let recorder = ShortcutRecorderButton(
            profileName: item.profile.name,
            shortcut: item.shortcut,
            onChange: { shortcut in setShortcut(item.profile, shortcut) },
            onFeedback: { text, isError in
                feedback.stringValue = text ?? ""
                feedback.textColor = isError ? .systemRed : .secondaryLabelColor
                feedback.isHidden = text == nil
            }
        )
        recorder.translatesAutoresizingMaskIntoConstraints = false
        recorder.widthAnchor.constraint(equalToConstant: 148).isActive = true

        let menuLabel = NSTextField(labelWithString: "Menu bar")
        menuLabel.font = .systemFont(ofSize: NSFont.smallSystemFontSize)
        menuLabel.textColor = .secondaryLabelColor

        let visibility = ProfileVisibilitySwitch(profile: item.profile, isOn: item.isVisible, onChange: setVisible)

        let mainRow = NSStackView(views: [avatar, name, recorder, menuLabel, visibility])
        mainRow.orientation = .horizontal
        mainRow.alignment = .centerY
        mainRow.spacing = 10

        let stack = NSStackView(views: [mainRow, feedback])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 3
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor),
            stack.topAnchor.constraint(equalTo: topAnchor),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor),
            mainRow.widthAnchor.constraint(equalTo: stack.widthAnchor),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}

@MainActor
private final class ProfileVisibilitySwitch: NSSwitch {
    private let profile: ChromeProfile
    private let onChange: (ChromeProfile, Bool) -> Void

    init(profile: ChromeProfile, isOn: Bool, onChange: @escaping (ChromeProfile, Bool) -> Void) {
        self.profile = profile
        self.onChange = onChange
        super.init(frame: .zero)
        state = isOn ? .on : .off
        target = self
        action = #selector(changeVisibility)
        setAccessibilityLabel("Show \(profile.name) in the menu bar")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    @objc private func changeVisibility() {
        onChange(profile, state == .on)
    }
}
