import AppKit
import ApplicationServices

enum ChromeFocusedProfile {
    static func detect(in profiles: [ChromeProfile]) -> ChromeProfile? {
        guard
            AXIsProcessTrusted(),
            let app = NSWorkspace.shared.frontmostApplication,
            app.bundleIdentifier == "com.google.Chrome"
        else { return nil }

        let chrome = AXUIElementCreateApplication(app.processIdentifier)
        var windowValue: CFTypeRef?
        guard
            AXUIElementCopyAttributeValue(chrome, kAXFocusedWindowAttribute as CFString, &windowValue) == .success,
            let windowValue,
            CFGetTypeID(windowValue) == AXUIElementGetTypeID()
        else { return nil }
        let window = windowValue as! AXUIElement

        var titleValue: CFTypeRef?
        guard
            AXUIElementCopyAttributeValue(window, kAXTitleAttribute as CFString, &titleValue)
                == .success,
            let title = titleValue as? String
        else { return nil }

        return match(windowTitle: title, profiles: profiles)
    }

    static func match(windowTitle: String, profiles: [ChromeProfile]) -> ChromeProfile? {
        let matches = profiles.filter {
            ChromeWindowTitleMatcher.matches(
                windowTitle: windowTitle, profileName: $0.name, personName: $0.personName)
        }
        return matches.count == 1 ? matches[0] : nil
    }
}
