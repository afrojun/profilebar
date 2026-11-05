# AGENTS.md

## Purpose

ProfileBar for Chrome is a Manifest V3 extension that moves the tabs a user chooses to another Chrome profile and routes new tabs to the profile their link-routing rule names. It owns the right-click menus, the destination group receiver, and the link router. The design is in [link-routing-design.md](../docs/link-routing-design.md). The ProfileBar app's native helper (`../Sources/NativeHost`) lists profiles and opens the URLs.

URL copying belongs to the separate Instant Copy URL extension. Do not add it here.

## Product invariants

- Close source tabs only after ProfileBar reports success, and only if they are unchanged. Otherwise leave them open and explain why.
- Never send a URL anywhere except the local native host, and only after an explicit menu choice, when a user's link-routing rule names another profile for a new tab, or when the user's fallback profile takes an unmatched link from another app.
- Link routing acts only on new tabs and never on popups, arrivals, sign-in sites, or tabs created in the first 3 seconds after the extension starts. Arrivals open blank and load their URL after request blocking skips them.
- `routing-rules.js` defines rule precedence, and the request-blocking priorities must pick the same winner. Change both together. ProfileBar Settings has a Swift copy of the matcher for **Test a link**. Add matching cases to `test/routing-cases.json`, which both test suites read, and keep the sign-in host list the same in both.
- Reload a tab after a request block at most once, because another extension may block it too.
- Only HTTP and HTTPS URLs can move.
- When the focused profile cannot be identified, show every destination rather than guessing.
- If the destination cannot recreate a group, ProfileBar opens the URLs without one. If the receiver claims a group but fails, the source group stays open.
- The helper is macOS-only. The `platform.os` check in `background.js` is the single gate to remove when other platforms are supported.

## Layout

- `background.js`: menu state, move flow, and the setup page's connection check.
- `router.js`: link routing in the service worker. It tracks new tabs, keeps the request-blocking rules, asks ProfileBar to route matching tabs, and opens arrivals.
- `routing-rules.js`: rule matching, precedence, and request-blocking rules, shared by the service worker and the setup page.
- `tab-splits.js`: finds the split views in a move and splits the arrived tabs again, shared by the service worker and the group receiver.
- `identify.*`: ProfileBar opens it in each profile so this copy of the extension learns its profile directory.
- `group-receiver.*`: claims a group handoff in the destination profile and recreates it.
- `setup.*`: first-run and options page with a live ProfileBar connection check and the link-routing settings.
- `move-status.*`: explains a failed or partial move.
- `icons/`: the three panels from the app icon on a transparent background. Regenerate them with `scripts/make-icons.swift` when `Resources/ProfileBarIcon.png` changes.
- `manage-profile.*`: ProfileBar opens it in a chosen profile so it can show that profile's `chrome://settings/manageProfile`, which Chrome will not open from the command line. The setup page's rename buttons use it when profiles share a name.
- Store-installed builds talk to `dev.afrojun.profilebar`. Unpacked builds have no `update_url` and talk to `dev.afrojun.profilebar.dev`, which ProfileBar Dev registers.

The native messaging protocol has both ends in this repository. Change them together, and keep older helpers safe: a helper that rejects a new request type must leave the source tabs open.

## Checks

From this folder:

```sh
node --test
./scripts/package.sh
python3 scripts/build-dev.py
```

Load the printed `dist/profilebar-for-chrome-dev` folder from `chrome://extensions` and always load it from that path, because the path sets the unpacked extension ID. Pass that ID to ProfileBar Dev as described in [development and releases](../docs/development.md). After a rebuild, reload the extension on `chrome://extensions`. Live move checks are in the [testing guide](../docs/testing.md). To verify a change yourself in the user's running Chrome, follow the [live extension check](../.claude/skills/live-extension-check/SKILL.md).

## Releasing

Pushing a tag `extension-vX.Y.Z` that matches `manifest.json` runs `.github/workflows/extension-release.yml`. It tests, packages, uploads to the existing Web Store item, and requests `DEFAULT_PUBLISH`. Chrome reviews the update, and it goes live automatically if approved. Listing text and screenshots stay manual. Their source of truth is [STORE_LISTING.md](STORE_LISTING.md).

The workflow authenticates through keyless Workload Identity Federation in the GitHub environment `chrome-web-store`, with the variables `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`, `CWS_PUBLISHER_ID`, and `CWS_EXTENSION_ID`. The Google Cloud provider must allow this repository on `refs/tags/extension-v` refs. App tags (`v*`) must not be able to publish the extension.

Release a ProfileBar version that supports a protocol change before the extension version that depends on it.
