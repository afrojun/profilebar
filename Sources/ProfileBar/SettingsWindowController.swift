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
    let linkRouting: Result<LinkRoutingSettings, Error>
}

struct SettingsActions {
    let snapshot: () -> SettingsSnapshot
    let setShortcut: (ChromeProfile, ProfileHotKey?) -> String?
    let setProfileVisible: (ChromeProfile, Bool) -> Void
    let setLaunchAtLogin: (Bool) -> String?
    let openAccessibilitySettings: () -> Void
    let saveLinkRouting: (LinkRoutingSettings) throws -> Void
}

@MainActor
final class SettingsWindowController: NSWindowController {
    private static let websiteURL = URL(string: "https://afrojun.dev/profilebar/")!
    private static let moveTabsGuideURL = URL(string: "https://afrojun.dev/profilebar/#move-tabs")!
    private static let linkRoutingGuideURL = URL(string: "https://afrojun.dev/profilebar/#link-routing")!
    private static let extensionURL = URL(
        string: "https://chromewebstore.google.com/detail/\(NativeHostRegistration.storeExtensionID)")!
    private static let repositoryURL = URL(string: "https://github.com/afrojun/profilebar")!
    private static let helpURL = repositoryURL.appending(path: "issues/new/choose")

    private let actions: SettingsActions
    private let pages = SettingsTabViewController()
    private var launchDetail: NSTextField?

    init(actions: SettingsActions) {
        self.actions = actions
        let window = NSWindow(contentViewController: pages)
        window.styleMask = [.titled, .closable]
        window.toolbarStyle = .preference
        window.title = "\(Self.appName) Settings"
        window.isReleasedWhenClosed = false
        super.init(window: window)
        refresh()
        window.center()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func present() {
        refresh()
        NSApp.activate()
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        // macOS may decline the activation request while another app is active.
        window?.orderFrontRegardless()
    }

    func refresh() {
        let snapshot = actions.snapshot()
        pages.show([
            SettingsPage(title: "Profiles", symbolName: "person.crop.circle", view: makeProfilesPage(snapshot)),
            SettingsPage(title: "Links", symbolName: "link", view: makeLinksPage(snapshot)),
            SettingsPage(title: "General", symbolName: "gearshape", view: makeGeneralPage(snapshot)),
        ])
    }

    private func makeProfilesPage(_ snapshot: SettingsSnapshot) -> NSView {
        let intro = Self.detail("Choose which profiles appear in the menu bar and set a shortcut for each one.")
        guard !snapshot.profiles.isEmpty else {
            let empty = NSTextField(labelWithString: snapshot.profileError ?? "No Chrome profiles were found.")
            empty.textColor = snapshot.profileError == nil ? .secondaryLabelColor : .systemRed
            return Self.page([intro, empty])
        }
        let rows = snapshot.profiles.map { item in
            ProfileSettingsRow(item: item, setShortcut: actions.setShortcut, setVisible: actions.setProfileVisible)
        }
        return Self.page([intro] + rows)
    }

    private func makeLinksPage(_ snapshot: SettingsSnapshot) -> NSView {
        Self.page([makeLinkRoutingSection(snapshot), Self.separator(), makeExtensionSection()])
    }

    private func makeGeneralPage(_ snapshot: SettingsSnapshot) -> NSView {
        Self.page([
            makeLaunchRow(snapshot.launchAtLogin), makeAccessibilityRow(snapshot.hasAccessibilityAccess),
            Self.separator(), makeFooter(),
        ])
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

    private func makeExtensionSection() -> NSView {
        let description = Self.detail(
            "ProfileBar for Chrome routes links with these rules and moves tabs and tab groups between profiles from "
                + "its right-click menu.")
        let extensionLink = linkButton("Get ProfileBar for Chrome", action: #selector(openExtensionStore))
        let rulesGuideLink = linkButton("How rules work", action: #selector(openLinkRoutingGuide))
        let moveTabsGuideLink = linkButton("How moving tabs works", action: #selector(openMoveTabsGuide))
        let links = NSStackView(views: [extensionLink, rulesGuideLink, moveTabsGuideLink])
        links.orientation = .horizontal
        links.spacing = 16

        let section = NSStackView(views: [Self.heading("ProfileBar for Chrome"), description, links])
        section.orientation = .vertical
        section.alignment = .leading
        section.spacing = 6
        return section
    }

    private func makeLinkRoutingSection(_ snapshot: SettingsSnapshot) -> NSView {
        let description = Self.detail("Open new tabs in the profile that a rule names for their site.")
        let section = NSStackView(views: [Self.heading("Link routing"), description])
        section.orientation = .vertical
        section.alignment = .leading
        section.spacing = 6
        switch snapshot.linkRouting {
        case .success(let settings):
            let editor = LinkRoutingSettingsView(
                settings: settings, profiles: snapshot.profiles.map(\.profile), save: actions.saveLinkRouting)
            section.addArrangedSubview(editor)
            editor.widthAnchor.constraint(equalTo: section.widthAnchor).isActive = true
        case .failure(let error):
            let message = Self.detail(LinkRoutingStore.unreadableMessage(for: error))
            message.textColor = .systemRed
            section.addArrangedSubview(message)
        }
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

    @objc private func openLinkRoutingGuide() {
        NSWorkspace.shared.open(Self.linkRoutingGuideURL)
    }

    @objc private func openRepository() {
        NSWorkspace.shared.open(Self.repositoryURL)
    }

    private static func heading(_ title: String) -> NSTextField {
        let label = NSTextField(labelWithString: title)
        label.font = .systemFont(ofSize: NSFont.systemFontSize, weight: .semibold)
        return label
    }

    /// Lays out one settings tab as a padded column whose views span its width.
    private static func page(_ views: [NSView]) -> NSView {
        let stack = NSStackView(views: views)
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        for view in views {
            view.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        }
        let page = NSView()
        page.addSubview(stack)
        NSLayoutConstraint.activate([
            page.widthAnchor.constraint(equalToConstant: 540),
            stack.leadingAnchor.constraint(equalTo: page.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: page.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: page.topAnchor, constant: 22),
            stack.bottomAnchor.constraint(equalTo: page.bottomAnchor, constant: -22),
        ])
        return page
    }

    private static func separator() -> NSView {
        let separator = NSBox()
        separator.boxType = .separator
        return separator
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

private struct SettingsPage {
    let title: String
    let symbolName: String
    let view: NSView
}

/// Shows each settings page as a toolbar tab and sizes the window to fit the selected page.
@MainActor
private final class SettingsTabViewController: NSTabViewController {
    init() {
        super.init(nibName: nil, bundle: nil)
        tabStyle = .toolbar
        canPropagateSelectedChildViewControllerTitle = false
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    /// Replaces the page contents, keeping the selected tab.
    func show(_ pages: [SettingsPage]) {
        if tabViewItems.isEmpty {
            for page in pages {
                let controller = SettingsPageController()
                controller.title = page.title
                let item = NSTabViewItem(viewController: controller)
                item.label = page.title
                item.image = NSImage(systemSymbolName: page.symbolName, accessibilityDescription: page.title)
                addTabViewItem(item)
            }
        }
        for (item, page) in zip(tabViewItems, pages) {
            (item.viewController as? SettingsPageController)?.show(page.view)
        }
    }
}

/// Keeps one container view per tab so a refresh swaps the page inside it instead of the tab's own view.
@MainActor
private final class SettingsPageController: NSViewController {
    override func loadView() {
        view = NSView()
    }

    func show(_ page: NSView) {
        for old in view.subviews { old.removeFromSuperview() }
        page.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(page)
        NSLayoutConstraint.activate([
            page.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            page.topAnchor.constraint(equalTo: view.topAnchor),
        ])
        preferredContentSize = page.fittingSize
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
