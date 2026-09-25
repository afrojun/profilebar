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

For settings or shortcut changes, also check that repeated **Settings…** actions reuse one window, a hidden menu-bar avatar does not disable its shortcut, and shortcut conflicts leave the previous assignment intact. Restore only settings changed for the test. Close only windows the test created, and do not remove Chrome profile data.

For tab moves, enable ProfileBar integration in Instant Copy URL and move an HTTP page to another Chrome profile. Check that the source tab closes only after the destination opens, the copy shortcut still works, and the extension gives a useful setup path when ProfileBar is unavailable.

For a release, also check **Start at login**, the update-check action, the drag-to-Applications DMG, and the installed app's signature and Accessibility trust. The signing, notarization, and publication steps live in [development and releases](development.md).
