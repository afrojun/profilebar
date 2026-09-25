# Development and releases

ProfileBar is a small native AppKit app with no third-party dependencies. You need macOS 14 or later, Google Chrome, and the Xcode command-line tools to build it.

## Run locally

```zsh
./run.sh
```

The first switch explains why Accessibility access is needed and links to **System Settings → Privacy & Security → Accessibility**. Grant access, then select the profile again.

## Build and test

```zsh
./test.sh
./build.sh
```

The default development build is written to `build/ProfileBar Dev.app`. It has its own bundle ID, preferences, Accessibility permission, login item, cool-world app icon, and three hollow menu-bar panels, so you can tell it apart from the release app. Quit the released app before running the development build to avoid duplicate menu-bar items and shortcut conflicts.

Development builds use the local `ProfileBar Local Signing` identity when available. Without it, the build uses an ad-hoc signature, which may cause macOS to ask for Accessibility permission after each rebuild.

GitHub Actions runs the same formatting, test, build, deployment-target, signature, and DMG checks for pull requests and pushes to `main`.

Follow the [testing guide](testing.md) for live profile, shortcut, and cross-Space checks. CI cannot run those Accessibility scenarios.

Format the Swift sources with the same rules enforced by the test script:

```zsh
xcrun swift-format format --in-place --configuration .swift-format --recursive Sources Tests
```

To inspect the permission without opening the app UI:

```zsh
./build/ProfileBar\ Dev.app/Contents/MacOS/ProfileBar --check-accessibility
```

## Submit a change

Work on a branch and open a pull request to `main`; direct pushes are blocked. Wait for the required `validate` check, address any review feedback, then merge. Confirm local `main` matches `origin/main` after merging. A merge does not publish an app update; only a pushed version tag starts the [release workflow](../.github/workflows/release.yml).

## Keep Accessibility permission across local builds

Run the one-time setup:

```zsh
./setup-signing.sh
```

The script creates a self-signed code-signing identity in your login keychain. Its private key stays in Keychain, and the script removes its temporary files. Each developer creates their own identity; never export or commit the private key.

The new identity may make macOS ask for Accessibility permission one final time. It is only for local builds and does not satisfy Gatekeeper or notarization.

To choose another identity, set `PROFILEBAR_SIGNING_IDENTITY` to the full name shown by:

```zsh
security find-identity -v -p codesigning
```

## Build the release app

Use the release variant only when testing or publishing the production app:

```zsh
./build.sh --release
```

It writes `build/ProfileBar.app`, keeps the canonical `dev.afrojun.ProfileBar` bundle ID from `Info.plist`, and requires a `Developer ID Application` certificate. Setting `PROFILEBAR_SIGNING_IDENTITY=-` produces the ad-hoc release build used by CI, but that build cannot be distributed. The DMG packager rejects the development bundle ID.

## Publish a release

Pushing a version tag runs [the release workflow](../.github/workflows/release.yml) on an Apple silicon macOS runner. It tests, signs, builds a drag-to-Applications DMG, notarizes, staples, verifies, and publishes the DMG with its SHA-256 checksum.

The reasons for using direct GitHub distribution are recorded in the [distribution decision](distribution-decision.md).

The tag must match `CFBundleShortVersionString` in `Info.plist`. Version `1.1.0`, for example, uses tag `v1.1.0`.

### Set up GitHub secrets

1. Open **Keychain Access**, select the **login** keychain, then select **My Certificates**.
2. Find and expand **Developer ID Application**. It must show a private key beneath it.
3. Right-click the certificate, choose **Export**, select **Personal Information Exchange (`.p12`)**, and protect it with a new export password. Save it outside this repository.
4. From this repository, run:

```zsh
/usr/bin/base64 -i /path/to/developer-id.p12 | gh secret set BUILD_CERTIFICATE_BASE64
gh secret set P12_PASSWORD
gh secret set APPLE_ID
gh secret set APPLE_TEAM_ID
gh secret set APPLE_APP_SPECIFIC_PASSWORD
```

The first command uploads the encoded certificate. The other commands prompt for their values without putting them in shell history:

- `P12_PASSWORD`: the export password chosen in Keychain Access.
- `APPLE_ID`: the email address used for the Apple Developer account.
- `APPLE_TEAM_ID`: the Team Identifier printed by `codesign -d --verbose=4 /Applications/ProfileBar.app`.
- `APPLE_APP_SPECIFIC_PASSWORD`: the dedicated ProfileBar password created at [account.apple.com](https://account.apple.com/) under **Sign-In and Security → App-Specific Passwords**.

### Create the release

From a committed `main` branch, complete the [live release checks](testing.md#live-app-checks) with a Developer ID-signed build and run `./test.sh` and `./build.sh --release`.

Then create and push the version tag:

```zsh
git tag -a v1.1.0 -m "ProfileBar 1.1.0"
git push origin v1.1.0
```

The workflow allows three hours for the job and up to 150 minutes for Apple's notarization service. It publishes nothing until notarization and verification succeed.

GitHub does not expose repository secrets to workflows from forks. The workflow runs only for tags pushed to this repository, and its built-in token can only publish repository contents.
