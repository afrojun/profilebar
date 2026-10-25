# Chrome Web Store listing

## Store listing

**Name:** ProfileBar for Chrome

**Summary:** Move tabs, selections, and tab groups to another Chrome profile from the right-click menu. Requires ProfileBar for Mac.

**Category:** Productivity › Workflow and planning

**Language:** English

**Detailed description:**

Keep work, personal, and side project pages in the profile where they belong.
Right-click a page, choose **Move tab to profile**, and pick a destination. The
page opens there, and the original tab closes once the move succeeds.

In Chrome 150 and later, right-click a tab to move it, move several selected
tabs together in tab order, or move a whole tab group. When this extension is
also installed in the destination profile, the group keeps its name, colour,
and collapsed state. Otherwise, the pages still open in the chosen profile
without a group.

ProfileBar for Chrome works with ProfileBar, a free menu-bar app for macOS that
switches Chrome profiles in one click. Chrome extensions cannot open pages in
another profile on their own, so the extension hands the selected URLs to
ProfileBar on your Mac, which asks Chrome to open them. Install ProfileBar from
https://afrojun.dev/profilebar/ and open it once before using the extension.

The extension stores no URLs and has no analytics, ads, tracking, accounts,
remote code, or network requests. URLs go only to ProfileBar on your device.
The source code is available under the MIT License.

Google Chrome is a trademark of Google LLC.

**Official URL:** afrojun.dev (verified site)

**Homepage:** https://afrojun.dev/profilebar/

**Support:** https://github.com/afrojun/profilebar/issues

**Privacy policy:**
https://github.com/afrojun/profilebar/blob/main/extension/PRIVACY.md

## Privacy

**Single purpose:** Move the tabs a user chooses to another Chrome profile
through the local ProfileBar app.

**Permission justifications:**

- `contextMenus`: Show the move actions and destination profiles in the page
  and tab right-click menus.
- `nativeMessaging`: Exchange the profile list and the selected URLs with the
  ProfileBar app on the same Mac, which opens the URLs in the chosen profile.
  When profiles share a name, the setup page also asks ProfileBar to open the
  chosen profile's settings so the user can rename it.
- `tabs`: Read the URLs of the clicked, selected, or grouped tabs when the user
  chooses a move action, then close those tabs after a successful move. The
  extension does not scan tabs in the background.
- `tabGroups`: Read the chosen group's title, colour, and collapsed state, then
  recreate them in the destination profile. Check whether the focused window
  has a tab group, without reading URLs, to show the group actions only when
  they apply.

**Remote code:** No. All executable code is included in the extension package.

**Data handling:** The extension handles selected tab URLs, which are web
browsing activity. It reads them only when the user chooses a move action and
sends them only to the ProfileBar app on the same device. Neither component
retains them or collects other user data.

Certify the limited-use declarations in the Dashboard. Check the Dashboard's
current wording before submission because Google may change the available data
categories.

## Distribution

- Free
- Public
- All regions
- Non-trader

## Test instructions

The Dashboard field holds 500 characters, so it carries a condensed version of
these steps.

Moving tabs needs the ProfileBar app on macOS and at least two Chrome profiles.

1. Install the extension before ProfileBar. The setup page should explain how
   to connect, and the right-click menu should offer **Set up ProfileBar…**.
2. Install ProfileBar 1.4 or later from https://afrojun.dev/profilebar/ and
   open it once. Choose **Check again** on the setup page. It should report
   **Connected**.
3. Right-click a normal HTTPS page, choose **Move tab to profile**, and select
   another profile. Confirm the page opens there and the original tab closes.
4. In Chrome 150 or later, select several HTTPS tabs, right-click one, and
   choose **Move tabs to profile**, then **Move tab to [profile]**. Confirm they
   open in tab order before the originals close.
5. Right-click a tab inside a group and choose **Move group to [profile]**.
   With the extension installed in the destination profile, confirm the group
   keeps its title, colour, and collapsed state.

## Assets

- Store icon: `icons/icon-128.png`
- Lead screenshot (1280x800): `store-assets/move-tab.png`
- Setup screenshot (1280x800): `store-assets/setup.png`, the setup page in its connected state
- Small promo tile (440x280): `store-assets/small-promo.png`

The HTML sources sit next to the PNGs. Render them at 1x device pixel ratio
and the exact size above. The setup screenshot comes from `setup.html` with
`chrome.runtime.sendMessage` stubbed to return `{ state: "ready", destinationCount: 2 }`.
