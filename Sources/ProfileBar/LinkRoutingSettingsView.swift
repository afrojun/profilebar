import AppKit

/// Edits the shared link-routing rules, which the extension's options page also edits. Each change saves at once.
/// See docs/link-routing-design.md.
@MainActor
final class LinkRoutingSettingsView: NSView, NSTableViewDataSource, NSTableViewDelegate, NSTextFieldDelegate {
    private struct Row {
        let id: String
        var kind: LinkRule.Kind
        var text: String
        var profileDirectory: String
    }

    private enum Column: String, CaseIterable {
        case kind, text, profile

        var title: String {
            switch self {
            case .kind: "Match"
            case .text: "Site or text"
            case .profile: "Profile"
            }
        }

        var width: CGFloat {
            switch self {
            case .kind: 120
            case .text: 200
            case .profile: 150
            }
        }
    }

    private static let kinds: [LinkRule.Kind] = [.host, .contains]

    private let profiles: [ChromeProfile]
    private let save: (LinkRoutingSettings) throws -> Void
    private var settings: LinkRoutingSettings
    private var rows: [Row]
    private let table = NSTableView()
    private let otherApps = NSButton(checkboxWithTitle: "Other apps", target: nil, action: nil)
    private let webPages = NSButton(checkboxWithTitle: "Web pages", target: nil, action: nil)
    private let fallback = NSPopUpButton(frame: .zero, pullsDown: false)
    private let status = NSTextField(wrappingLabelWithString: "")
    private let linkTest = NSTextField()
    private let linkTestResult = NSTextField(wrappingLabelWithString: "")

    init(settings: LinkRoutingSettings, profiles: [ChromeProfile], save: @escaping (LinkRoutingSettings) throws -> Void)
    {
        self.settings = settings
        self.profiles = profiles
        self.save = save
        rows = settings.rules.map { rule in
            Row(
                id: rule.id, kind: rule.kind,
                text: rule.kind == .host ? "\(rule.host ?? "")\(rule.pathPrefix ?? "")" : rule.text ?? "",
                profileDirectory: rule.profileDirectory)
        }
        super.init(frame: .zero)
        layOut()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func layOut() {
        let sourcesLabel = NSTextField(labelWithString: "Route links from:")
        for (checkbox, isOn) in [(otherApps, settings.routeFrom.otherApps), (webPages, settings.routeFrom.webPages)] {
            checkbox.state = isOn ? .on : .off
            checkbox.target = self
            checkbox.action = #selector(changeSources)
        }
        let sources = NSStackView(views: [sourcesLabel, otherApps, webPages])
        sources.orientation = .horizontal
        sources.spacing = 14

        // Links from other apps that match no rule. Links that pages open stay, so browsing in a profile isn't
        // pulled into another one.
        fallback.addItem(withTitle: "The profile Chrome picks")
        for profile in profiles {
            addProfileItem(to: fallback, title: title(of: profile), directory: profile.directory)
        }
        if let directory = settings.fallbackProfileDirectory, !profiles.contains(where: { $0.directory == directory }) {
            addProfileItem(to: fallback, title: "\(directory) (not found)", directory: directory)
        }
        fallback.select(
            fallback.itemArray.first { $0.representedObject as? String == settings.fallbackProfileDirectory })
        fallback.isEnabled = settings.routeFrom.otherApps
        fallback.target = self
        fallback.action = #selector(saveRows)
        let fallbackRow = NSStackView(views: [NSTextField(labelWithString: "Open other links from apps in:"), fallback])
        fallbackRow.orientation = .horizontal
        fallbackRow.spacing = 8

        for column in Column.allCases {
            let tableColumn = NSTableColumn(identifier: NSUserInterfaceItemIdentifier(column.rawValue))
            tableColumn.title = column.title
            tableColumn.width = column.width
            table.addTableColumn(tableColumn)
        }
        table.columnAutoresizingStyle = .firstColumnOnlyAutoresizingStyle
        table.dataSource = self
        table.delegate = self
        table.rowHeight = 26
        table.usesAlternatingRowBackgroundColors = true
        let scroll = NSScrollView()
        scroll.documentView = table
        scroll.hasVerticalScroller = true
        scroll.borderType = .bezelBorder
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.heightAnchor.constraint(equalToConstant: 288).isActive = true

        let addRemove = NSSegmentedControl(
            images: [NSImage(named: NSImage.addTemplateName)!, NSImage(named: NSImage.removeTemplateName)!],
            trackingMode: .momentary, target: self, action: #selector(addOrRemoveRule(_:)))
        addRemove.setToolTip("Add rule", forSegment: 0)
        addRemove.setToolTip("Remove selected rule", forSegment: 1)
        status.font = .systemFont(ofSize: NSFont.smallSystemFontSize)
        status.textColor = .secondaryLabelColor
        let controls = NSStackView(views: [addRemove, status])
        controls.orientation = .horizontal
        controls.alignment = .centerY
        controls.spacing = 12

        linkTest.placeholderString = "https://example.com/page"
        linkTest.delegate = self
        linkTest.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let linkTestRow = NSStackView(views: [NSTextField(labelWithString: "Test a link:"), linkTest])
        linkTestRow.orientation = .horizontal
        linkTestRow.spacing = 8
        linkTestResult.font = .systemFont(ofSize: NSFont.smallSystemFontSize)
        linkTestResult.textColor = .secondaryLabelColor

        let stack = NSStackView(views: [sources, fallbackRow, scroll, controls, linkTestRow, linkTestResult])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor),
            stack.topAnchor.constraint(equalTo: topAnchor),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor),
            scroll.widthAnchor.constraint(equalTo: stack.widthAnchor),
            linkTestRow.widthAnchor.constraint(equalTo: stack.widthAnchor),
            linkTestResult.widthAnchor.constraint(equalTo: stack.widthAnchor),
        ])
    }

    private var textColumnIndex: Int {
        table.column(withIdentifier: NSUserInterfaceItemIdentifier(Column.text.rawValue))
    }

    func numberOfRows(in tableView: NSTableView) -> Int { rows.count }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let rule = rows[row]
        switch tableColumn.flatMap({ Column(rawValue: $0.identifier.rawValue) }) {
        case .kind:
            let popup = popUp(action: #selector(changeKind(_:)))
            for kind in Self.kinds { popup.addItem(withTitle: kind == .host ? "Site" : "URL contains") }
            popup.selectItem(at: Self.kinds.firstIndex(of: rule.kind) ?? 0)
            return popup
        case .text:
            let field = NSTextField(string: rule.text)
            field.placeholderString = rule.kind == .host ? "example.com or github.com/team" : "Text in the URL"
            field.isBordered = false
            field.drawsBackground = false
            field.target = self
            field.action = #selector(changeText(_:))
            field.cell?.sendsActionOnEndEditing = true
            return field
        case .profile, nil:
            let popup = popUp(action: #selector(changeProfile(_:)))
            for profile in profiles {
                addProfileItem(to: popup, title: title(of: profile), directory: profile.directory)
            }
            if !profiles.contains(where: { $0.directory == rule.profileDirectory }) {
                addProfileItem(
                    to: popup, title: "\(rule.profileDirectory) (not found)", directory: rule.profileDirectory)
            }
            popup.select(popup.itemArray.first { $0.representedObject as? String == rule.profileDirectory })
            return popup
        }
    }

    /// Adds the item through the menu, because `addItem(withTitle:)` replaces an item with the same title.
    private func addProfileItem(to popup: NSPopUpButton, title: String, directory: String) {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.representedObject = directory
        popup.menu?.addItem(item)
    }

    /// Names the folder too when profiles share a name, as the extension does.
    private func title(of profile: ChromeProfile) -> String {
        let sharesName = profiles.contains { $0.name == profile.name && $0.directory != profile.directory }
        return sharesName ? "\(profile.name) (\(profile.directory))" : profile.name
    }

    private func popUp(action: Selector) -> NSPopUpButton {
        let popup = NSPopUpButton(frame: .zero, pullsDown: false)
        popup.isBordered = false
        popup.target = self
        popup.action = action
        return popup
    }

    @objc private func changeKind(_ sender: NSPopUpButton) {
        let row = table.row(for: sender)
        guard rows.indices.contains(row) else { return }
        rows[row].kind = Self.kinds[sender.indexOfSelectedItem]
        table.reloadData(forRowIndexes: [row], columnIndexes: [textColumnIndex])
        saveRows()
    }

    @objc private func changeText(_ sender: NSTextField) {
        let row = table.row(for: sender)
        guard rows.indices.contains(row), rows[row].text != sender.stringValue else { return }
        rows[row].text = sender.stringValue
        saveRows()
    }

    @objc private func changeProfile(_ sender: NSPopUpButton) {
        let row = table.row(for: sender)
        guard rows.indices.contains(row), let directory = sender.selectedItem?.representedObject as? String else {
            return
        }
        rows[row].profileDirectory = directory
        saveRows()
    }

    @objc private func changeSources() {
        fallback.isEnabled = otherApps.state == .on
        saveRows()
    }

    @objc private func addOrRemoveRule(_ sender: NSSegmentedControl) {
        if sender.selectedSegment == 0 {
            rows.append(
                Row(
                    id: UUID().uuidString, kind: .host, text: "",
                    profileDirectory: profiles.first?.directory ?? "Default"))
            table.reloadData()
            table.editColumn(textColumnIndex, row: rows.count - 1, with: nil, select: true)
        } else if rows.indices.contains(table.selectedRow) {
            rows.remove(at: table.selectedRow)
            table.reloadData()
            saveRows()
        }
    }

    /// Saves every row that has a site or text. A new rule saves once it has one.
    @objc private func saveRows() {
        let saved = rows.enumerated().filter { !$0.element.text.trimmingCharacters(in: .whitespaces).isEmpty }
        var updated = settings
        updated.routeFrom = .init(otherApps: otherApps.state == .on, webPages: webPages.state == .on)
        updated.rules = saved.map { Self.rule(from: $0.element) }
        updated.fallbackProfileDirectory = fallback.selectedItem?.representedObject as? String
        do {
            try save(updated)
            settings = updated
            showLinkTest()
            show("Saved.", isError: false)
        } catch let error as LinkRoutingError {
            if let index = error.ruleIndex, saved.indices.contains(index) {
                table.selectRowIndexes([saved[index].offset], byExtendingSelection: false)
            }
            show(error.message, isError: true)
        } catch {
            show("ProfileBar could not save the rules: \(error.localizedDescription)", isError: true)
        }
    }

    func controlTextDidChange(_ notification: Notification) {
        if notification.object as? NSTextField === linkTest { showLinkTest() }
    }

    /// Explains where the saved rules send the link in the test box, with the same wording as the options page.
    private func showLinkTest() {
        linkTestResult.stringValue = linkTestMessage(linkTest.stringValue.trimmingCharacters(in: .whitespaces))
    }

    private func linkTestMessage(_ link: String) -> String {
        guard !link.isEmpty else { return "" }
        guard link.range(of: #"^https?://"#, options: [.regularExpression, .caseInsensitive]) != nil else {
            return "Enter a link that starts with http:// or https://."
        }
        guard settings.routeFrom.otherApps || settings.routeFrom.webPages else { return "Link routing is off." }
        if let host = URL(string: link)?.host()?.lowercased(), LinkRoutingSettings.isSignInHost(host) {
            return "Sign-in sites always stay where they open."
        }
        if let rule = settings.winningRule(for: link) {
            let name =
                rule.kind == .host
                ? "site rule \(rule.host ?? "")\(rule.pathPrefix ?? "")" : "“URL contains” rule \(rule.text ?? "")"
            return "Opens in \(profileName(rule.profileDirectory)), using the \(name)."
        }
        guard let fallback = settings.fallbackProfileDirectory else {
            return "No rule matches, so it stays where Chrome opens it."
        }
        return "No rule matches. From other apps it opens in \(profileName(fallback)). "
            + "From web pages it stays where it opened."
    }

    private func profileName(_ directory: String) -> String {
        profiles.first { $0.directory == directory }.map(title(of:)) ?? directory
    }

    private func show(_ message: String, isError: Bool) {
        status.stringValue = message
        status.textColor = isError ? .systemRed : .secondaryLabelColor
    }

    /// Reads a site typed as "github.com/team" or pasted as a URL.
    private static func rule(from row: Row) -> LinkRule {
        let text = row.text.trimmingCharacters(in: .whitespaces)
        guard row.kind == .host else {
            return LinkRule(
                id: row.id, kind: .contains, host: nil, pathPrefix: nil, text: text,
                profileDirectory: row.profileDirectory)
        }
        let site = text.replacingOccurrences(
            of: #"^https?://"#, with: "", options: [.regularExpression, .caseInsensitive])
        let slash = site.firstIndex(of: "/") ?? site.endIndex
        let path = String(site[slash...])
        return LinkRule(
            id: row.id, kind: .host, host: site[..<slash].lowercased(), pathPrefix: path == "/" ? "" : path, text: nil,
            profileDirectory: row.profileDirectory)
    }
}
