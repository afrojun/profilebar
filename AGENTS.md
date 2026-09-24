# AGENTS.md

## Purpose

ProfileBar is a native macOS menu-bar app. One action must switch to an open Chrome profile, even across desktop Spaces, or open it when no window exists.

## Product invariants

- Profile-avatar clicks and global shortcuts must call the same switch-or-open path.
- Profile-avatar clicks and shortcuts must never copy, reopen, or forward the current page URL. The separate browser extension action may open a user-selected URL in a user-selected profile.
- Search Accessibility windows across every running Chrome instance first, including other desktop Spaces. If no window matches, try Chrome's profile command without showing its Profiles menu, then launch the profile as a last resort.
- Match profile menu labels exactly by profile name or by Chrome's qualified `Person (Profile)` form. A person name alone is ambiguous.
- Store profile preferences by Chrome's stable profile directory, not by display name or list position.
- Each profile avatar is optional. Keep the settings item so Settings and Quit are always available.
- Reuse the Settings window. Repeated menu actions must not open copies.
- Shortcut recording must require at least one modifier. Escape cancels recording; Delete clears the assignment.
- Register only assigned hotkeys. Do not install a global keyboard monitor or save typed input.

## Architecture

- `ChromeProfile.swift` owns profile loading and validation.
- `ChromeProfileActivator.swift` owns normal switch-or-open activation.
- `NativeHostRegistration.swift` registers Chrome's local native messaging host.
- `Sources/NativeHost` handles explicit open-URL requests from the extension.
- `ChromeWindowTitleMatcher.swift` owns Chrome label matching and should remain independently testable.
- `ProfileShortcut.swift` owns persisted shortcut values and profile-icon visibility.
- `GlobalHotKeyRegistrar.swift` owns Carbon hotkey registration and dispatch only.
- `ShortcutRecorderButton.swift` owns shortcut capture and recording feedback.
- `SettingsWindowController.swift` owns the native settings window and rows.
- `UpdateChecker.swift` owns release lookup, check timing, version comparison, and update prompts.
- `ProfileAvatarRenderer.swift` owns avatar and monogram rendering.
- `main.swift` coordinates the app. Keep policy here and mechanics in the focused types above.

Prefer a small native AppKit solution. Add a package manager or third-party dependency only when platform APIs cannot meet an agreed need.

## Working method

For a feature:

1. State the user-visible outcome and the rules it must preserve.
2. Find which file owns the behavior before adding a type or stored state.
3. Keep pure rules separate and testable; keep AppKit flow thin.
4. Build the smallest complete change.
5. Test the main path and its fallback using the [testing guide](docs/testing.md).

For a bug:

1. Write a fast, repeatable command that shows the exact bug.
2. Capture the failure before changing code, then shrink the steps while they still fail.
3. List testable causes and check the most likely one first.
4. Test the code that failed. If AppKit behavior has no useful unit test, record the live UI check in the handoff.
5. Apply the smallest fix. Rerun both the short check and the original stress case.
6. Remove temporary test artifacts and restore only the preferences changed for the test. Never clear the user's settings.

Before finishing non-trivial code, read the diff as a new reviewer. The main flow should read top-to-bottom at one level. Extract helpers only for clear duties. Avoid pass-through helpers, unneeded fallbacks, parallel collections, and state that can be derived.

## Security and privacy

- Treat Chrome's `Local State` and profile directories as read-only inputs.
- Check profile directories at the process-launch boundary. Never put an unchecked directory in a shell command.
- Use `Process` arguments rather than shell evaluation.
- Do not commit real profile names, account names, email addresses, home-directory paths, screenshots, Chrome data, certificates, private keys, or Accessibility database state.
- Keep signing keys in Keychain. `setup-signing.sh` may make a local identity, but key material never belongs in the repository.
- Do not use private SkyLight or CGS APIs. They are fragile and block standard distribution.
- Do not bypass macOS privacy controls. The user must grant Accessibility access in System Settings.
- Update checks may read GitHub's public latest-release endpoint. Never include profile or browser data in the request.
- Preserve unrelated working-tree changes. Do not use destructive Git or filesystem commands to clean up user-owned work.

## UI conventions

- Use native AppKit controls, system colors, SF typography, and standard macOS shortcut symbols.
- Use Chrome profile avatars as the visual cue; keep the rest of the UI quiet and compact.
- Use plain, action-oriented labels such as `Settings…`, `Menu bar`, and `Start at login`.
- Show actionable errors. A shortcut conflict should leave the previous assignment intact.
- Preserve the user's shortcuts and per-profile icon settings during UI tests. Restore any state the test changes.

## Build and test

Follow the [testing guide](docs/testing.md) for the full checklist and live Accessibility test matrix. The baseline commands are:

```zsh
./test.sh
./build.sh --dev
PROFILEBAR_SIGNING_IDENTITY=- ./build.sh --release
```

The last command matches CI's ad-hoc release build; it checks compilation but is not suitable for installation or distribution. A live test of the production app requires a Developer ID-signed `./build.sh --release` build. The development app has a separate bundle ID and Accessibility permission. Never install an ad-hoc build over a certificate-signed app.

Before handing back a code or build change:

1. Run the baseline commands above and verify both built signatures with `codesign --verify --deep --strict`.
2. Run `git diff --check` and check the diff for credentials, personal data, user paths, and generated files.
3. Read the main flow top-to-bottom and remove unneeded state or indirection.
4. For live UI work, confirm the installed signed app was built from the current source and is trusted for Accessibility.

For documentation-only changes, check links and `git diff --check`; rerun the build checks when the documented commands or behavior have changed.

The scripts create throwaway test binaries. In a restricted environment, point `CLANG_MODULE_CACHE_PATH` and `SWIFT_MODULECACHE_PATH` to a writable temporary directory instead of changing the scripts.

The sandbox may hide login Keychain identities. Build with Keychain access for a signed live test, then verify the installed signature and Accessibility trust.

## Regression coverage

- Add focused pure-logic cases to `Tests/ProfileBarTests.swift`. Accessibility and menu-bar behavior need a signed live-app check; a test binary has a different Accessibility identity.
- For window bugs, repeat the real action and check the live window count. Add timing stress for intermittent bugs. Use the scenarios in the [testing guide](docs/testing.md).

## Documentation and distribution

- Update `README.md` whenever user-visible behavior, permissions, settings, build steps, or limitations change.
- Keep local self-signed builds separate from public releases. Public binaries need an Apple Developer ID signature and notarization, or Mac App Store signing.
- Do not commit the built `.app`; `build/` remains generated output.
- Submit changes through a branch and pull request; `main` requires the `validate` check. Follow [development and release procedures](docs/development.md). A merge does not publish a release; a version tag triggers the [release workflow](.github/workflows/release.yml).
