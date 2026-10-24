# AGENTS.md

## Purpose

ProfileBar for Chrome is a Manifest V3 extension that moves the tabs a user chooses to another Chrome profile. It owns the right-click menus and the destination group receiver. The ProfileBar app's native helper (`../Sources/NativeHost`) lists profiles and opens the URLs.

URL copying belongs to the separate Instant Copy URL extension. Do not add it here.

## Product invariants

- Close source tabs only after ProfileBar reports success, and only if they are unchanged. Otherwise leave them open and explain why.
- Never send a URL anywhere except the local native host, and only after an explicit menu choice.
- Only HTTP and HTTPS URLs can move.
- When the focused profile cannot be identified, show every destination rather than guessing.
- If the destination cannot recreate a group, ProfileBar opens the URLs without one. If the receiver claims a group but fails, the source group stays open.
- The helper is macOS-only. The `platform.os` check in `background.js` is the single gate to remove when other platforms are supported.

## Layout

- `background.js`: menu state, move flow, and the setup page's connection check.
- `group-receiver.*`: claims a group handoff in the destination profile and recreates it.
- `setup.*`: first-run and options page with a live ProfileBar connection check.
- `move-status.*`: explains a failed or partial move.
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

Load the printed `dist/profilebar-for-chrome-dev` folder from `chrome://extensions` and always load it from that path, because the path sets the unpacked extension ID. Pass that ID to ProfileBar Dev as described in [development and releases](../docs/development.md). After a rebuild, reload the extension on `chrome://extensions`. Live move checks are in the [testing guide](../docs/testing.md).

## Releasing

Pushing a tag `extension-vX.Y.Z` that matches `manifest.json` runs `.github/workflows/extension-release.yml`. It tests, packages, uploads to the existing Web Store item, and requests `DEFAULT_PUBLISH`. Chrome reviews the update, and it goes live automatically if approved. Listing text and screenshots stay manual. Their source of truth is [STORE_LISTING.md](STORE_LISTING.md).

The workflow authenticates through keyless Workload Identity Federation in the GitHub environment `chrome-web-store`, with the variables `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`, `CWS_PUBLISHER_ID`, and `CWS_EXTENSION_ID`. The Google Cloud provider must allow this repository on `refs/tags/extension-v` refs. App tags (`v*`) must not be able to publish the extension.

Release a ProfileBar version that supports a protocol change before the extension version that depends on it.
