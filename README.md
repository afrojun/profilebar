<p align="center">
  <img src="Resources/ProfileBarIcon.png" width="128" alt="ProfileBar app icon">
</p>

<h1 align="center">ProfileBar</h1>

<p align="center">Switch Chrome profiles instantly. Move pages between them with Instant Copy URL.</p>

<p align="center">
  <a href="https://afrojun.dev/profilebar/">Website</a> ·
  <a href="https://github.com/afrojun/profilebar/releases/latest">Download</a>
</p>

<p align="center">
  <img src="docs/images/menu-bar.png" width="304" alt="Three Chrome profile buttons and the ProfileBar button in the macOS menu bar">
</p>

ProfileBar puts your Chrome profiles in the macOS menu bar. Click a profile avatar or press its keyboard shortcut to switch in one step, without opening Chrome's **Profiles** menu.

If that profile already has a window open, ProfileBar brings it forward, even from another desktop Space. If it does not, ProfileBar opens the profile normally.

With [Instant Copy URL](https://chromewebstore.google.com/detail/instant-copy-url/dhalfjnfoocnfpppmkpidbliccemicno),
you can right-click a page and choose **Move tab to profile**, or right-click a
tab and choose **Copy or move tabs**, to open URLs in another Chrome profile.
The extension closes the original tabs after ProfileBar reports success. Enable
the optional ProfileBar integration from the extension's setup page or menu the
first time. ProfileBar registers the local Chrome helper when it launches. If
the extension cannot find it, launch ProfileBar and choose **Refresh profiles**
from the extension menu.

Select several tabs and right-click one of them to move their URLs together.
Instant Copy URL reads the selected URLs, ProfileBar opens them in tab order,
and the extension closes the originals after the handoff. To move a whole tab
group, right-click a tab inside it and choose **Move group to [profile]**. If
Instant Copy URL 1.8.0 or newer is installed with ProfileBar access enabled in
the destination profile, it recreates the group title, colour, and collapsed
state. Otherwise, ProfileBar opens the URLs without a group. **Copy group URLs**
copies every URL in the group without moving it.

## Use it

Each avatar in the menu bar belongs to one Chrome profile. Click the one you want and ProfileBar will switch to it or open it as needed.

Open **Settings…** from the ProfileBar button to:

- Set a global keyboard shortcut for each profile.
- Choose which profile avatars stay in the menu bar.
- Start ProfileBar automatically when you sign in.
- Find Instant Copy URL and a guide to moving tabs between profiles.

<p align="center">
  <img src="docs/images/settings.png" width="720" alt="ProfileBar settings with Personal, Work, and Side project profiles">
</p>

Profile shortcuts work from any app. ProfileBar only registers the combinations you assign; it does not monitor what you type.

## Updates

Choose **Check for Updates…** from the ProfileBar menu at any time. ProfileBar also checks about 10 seconds after launch when it has not checked successfully in the last 24 hours, then once per day while it remains open. Automatic checks stay quiet unless a new version is available.

The check reads the latest public release from GitHub and identifies the installed ProfileBar version in its request. It does not send profile names, browser activity, or other app data. Installing an update still uses the signed DMG from [GitHub Releases](https://github.com/afrojun/profilebar/releases).

## Install

1. Download the latest `.dmg` from [GitHub Releases](https://github.com/afrojun/profilebar/releases).
2. Open it and drag **ProfileBar** to **Applications**.
3. Launch ProfileBar from Applications.

The first time you switch to an open profile, macOS asks you to allow ProfileBar in **System Settings → Privacy & Security → Accessibility**. Grant access, then select the profile again.

Current releases require macOS 14 or later and an Apple silicon Mac.

## Why Accessibility access?

Chrome does not provide a public API for bringing a specific profile window to the front. ProfileBar uses macOS Accessibility to raise a matching window first. If there is no window, it tries Chrome's profile command without showing the menu.

ProfileBar reads Chrome's local profile list and saved avatars. Its helper checks
the focused Chrome window title to identify the current profile for the
extension menu; when it cannot identify one uniquely, the extension shows every
profile. For an explicit tab or group move, the helper receives the selected
URLs and profile directory from the extension and passes them to Chrome. Group
moves also carry the visible group details through a temporary local relay when
the destination extension can receive them. ProfileBar does not store the URLs
or send profile data to a server. Ordinary profile switching never uses the
current page URL. ProfileBar does not bypass macOS permission controls.

## Limitations

- Profile switching currently expects Chrome's **Profiles** menu to be in English.
- ProfileBar cannot turn the current Chrome window into a different profile.
- If Chrome changes its menu or window labels, ProfileBar may need an update.
- The extension opens HTTP and HTTPS URLs in another profile. Chrome 150 and later show its menu on tabs and pages; older supported versions show it on pages.

## Help and feedback

Open **Settings…** and choose **Help & Feedback** to report a bug or suggest an improvement. You can also [open an issue directly](https://github.com/afrojun/profilebar/issues/new/choose).

Please report security concerns privately using the instructions in the [security policy](SECURITY.md), not in a public issue.

## Development

Want to build ProfileBar, run the tests, or publish a release? See [Development and releases](docs/development.md).

## License

ProfileBar is available under the [MIT License](LICENSE).

Created by [Arjun Radhakrishnan](https://afrojun.dev/).
