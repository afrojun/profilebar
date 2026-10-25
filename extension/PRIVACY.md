# ProfileBar for Chrome Privacy Policy

Effective date: 25 October 2026

ProfileBar for Chrome reads tab URLs only when you choose a move action from
its right-click menu. It reads the clicked tab, the highlighted tabs, or the
tabs in the chosen group. For a group move, it also reads the group's title,
colour, and collapsed state. To show the group actions only when they apply, it
checks whether the focused window has any tab group, which reads no URLs. It
does not scan tabs in the background.

The extension talks to the ProfileBar app on the same Mac through Chrome's
local native messaging channel. ProfileBar sends it the list of Chrome profiles
so it can show destinations. ProfileBar may read the focused Chrome window
title to identify the current profile and leave it out of the menu. When you
choose a destination, the extension sends the selected URLs and the profile
directory to ProfileBar, which asks Chrome to open them in that profile. The
extension then closes the original tabs. For group moves, a temporary local
relay lets the extension in the destination profile recreate the group. If it
is not installed there, ProfileBar opens the URLs without a group.

When more than one profile has the same name, the setup page offers to rename
them. Choosing **Rename** sends that profile's directory name to ProfileBar,
which checks Chrome's local preferences to confirm this extension is enabled
there, then opens the extension in that profile so it can show Chrome's
profile settings.

Neither component stores the URLs. The extension makes no network requests and
has no analytics, advertising, tracking, accounts, or remote code. Chrome loads
the selected URLs in the destination profile as it would for any page you open.

Use of information received from Google APIs will adhere to the Chrome Web
Store User Data Policy, including the Limited Use requirements.

## Permissions

- `contextMenus` adds the move actions to the page and tab right-click menus.
- `nativeMessaging` connects to ProfileBar on this Mac.
- `tabs` reads the URLs of the tabs you choose to move and closes them after a
  successful move.
- `tabGroups` reads a chosen group's visible details and recreates them in the
  destination profile, and checks whether the focused window has a group.

## Changes

Material changes to this policy will be published here with a new effective
date.

## Contact

For privacy questions, email
[extensions@afrojun.dev](mailto:extensions@afrojun.dev).
