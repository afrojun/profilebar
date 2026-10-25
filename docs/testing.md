# Testing ProfileBar

Use automated checks for pure logic and builds, then test macOS Accessibility behavior in a signed app. CI cannot grant Accessibility permission or verify desktop Spaces, so a passing workflow does not replace the live checks.

## Automated checks

From the repository root:

```zsh
./test.sh
./build.sh --dev
PROFILEBAR_SIGNING_IDENTITY=- ./build.sh --release
codesign --verify --deep --strict 'build/ProfileBar Dev.app'
codesign --verify --deep --strict build/ProfileBar.app
git diff --check
```

`test.sh` runs strict Swift formatting checks, compiles with warnings treated as errors, and runs `Tests/ProfileBarTests.swift`. The build commands compile both bundle variants; the ad-hoc release build mirrors [CI](../.github/workflows/ci.yml) but must not be installed or distributed. In a restricted environment, set `CLANG_MODULE_CACHE_PATH` and `SWIFT_MODULECACHE_PATH` to writable temporary directories.

## Live app checks

Use a signed app built from the current source. The development app has its own bundle ID, settings, and Accessibility permission. To test the installed production app, build with a Developer ID identity using `./build.sh --release`; never replace a certificate-signed installation with an ad-hoc build. Verify the installed signature with `codesign --verify --deep --strict /Applications/ProfileBar.app` and permission with `/Applications/ProfileBar.app/Contents/MacOS/ProfileBar --check-accessibility`. macOS may ask for Accessibility access again if the signing identity changes.

Record the starting Chrome window count and any ProfileBar settings you plan to change. Keep existing windows and user preferences intact. Check both a profile avatar and an assigned shortcut for the behavior under test:

1. Select a profile with a window in the current Space. Its existing window should come forward without increasing Chrome's window count.
2. Select a profile with a window in another Space. It should come forward without creating a window.
3. Select a profile with no open window. Exactly one window should open in that profile, without copying the current page URL.
4. If multiple Chrome processes already exist, or a safe isolated fixture is available, repeat with a second or headless instance. A window in any instance must be found before ProfileBar tries a menu command or opens a new one.

If two profiles share a name, repeat these checks for each of them. Chrome titles their windows identically, so ProfileBar picks them by their order in Chrome's **Profiles** menu, and each must bring forward its own window.

For settings or shortcut changes, also check that repeated **Settings…** actions reuse one window, a hidden menu-bar avatar does not disable its shortcut, and shortcut conflicts leave the previous assignment intact. Restore only settings changed for the test. Close only windows the test created, and do not remove Chrome profile data.

For tab moves, load the ProfileBar for Chrome development build and move an HTTP page to another Chrome profile. Check that the source tab closes only after the destination opens, and that the setup page and menu give a useful setup path when ProfileBar is unavailable.
With a Chrome window focused, confirm its own profile is absent from the extension's page and tab destination menus. When Accessibility access is unavailable or the focused window cannot be matched uniquely, confirm all profiles remain visible.

For a group move, right-click a tab inside a group. With the extension installed
in the destination profile, check that its URLs open
in tab order with the same title, colour, and collapsed state before the source
group closes. Repeat with the extension absent or disabled in the destination:
the URLs should open without a group. If the receiver claims a handoff but
cannot create the group, the source group must stay open. The group items should appear only in windows that have a tab group.

If two profiles share a name, the extension's setup page should show a **Rename** button for each. A button should open `chrome://settings/manageProfile` in that profile when the extension is installed there, and otherwise explain how to rename it by hand.

For a release, also check **Start at login**, the update-check action, the drag-to-Applications DMG, and the installed app's signature and Accessibility trust. The signing, notarization, and publication steps live in [development and releases](development.md).
