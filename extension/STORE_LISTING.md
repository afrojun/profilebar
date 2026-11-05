# Chrome Web Store listing

## Store listing

**Name:** ProfileBar for Chrome

**Summary:** Move tabs and groups to another Chrome profile, and open links in the right profile automatically. Requires ProfileBar for Mac.

**Category:** Productivity › Workflow and planning

**Language:** English

**Detailed description:**

Keep work, personal, and side project pages in the profile where they belong.
Right-click a page, choose **Move tab to profile**, and pick a destination. The
page opens there, and the original tab closes once the move succeeds. The
extension's toolbar icon offers the same moves for the tab you're on, including
its whole group.

In Chrome 150 and later, right-click a tab to move it, move several selected
tabs together in tab order, or move a whole tab group. When this extension is
also installed in the destination profile, the group keeps its name, colour,
and collapsed state. Otherwise, the pages still open in the chosen profile
without a group. Moving either half of a split view from the tab strip moves
both. With ProfileBar 1.6, Chrome 155 or later, and this extension in the
destination profile, they open side by side again.

Link routing opens new tabs in the profile you choose for each site, without
making anything your default browser. Add rules on the options page, in
ProfileBar's settings, or by right-clicking a page and choosing **Always open
this site in**. A link from another app or a link that a page opens in a new
tab then moves to its profile in about a tenth of a second. Links that match no
rule stay where they open, or links from other apps can go to a profile you
choose.

ProfileBar for Chrome works with ProfileBar, a free menu-bar app for macOS that
switches Chrome profiles in one click. Chrome extensions cannot open pages in
another profile on their own, so the extension hands the selected URLs to
ProfileBar on your Mac, which asks Chrome to open them. Install ProfileBar from
https://afrojun.dev/profilebar/ and open it once before using the extension.

The extension stores no URLs and has no analytics, ads, tracking, accounts,
remote code, or network requests. Link routing checks new tabs against your
rules on your device. URLs go only to ProfileBar on your device.
The source code is available under the MIT License.

Google Chrome is a trademark of Google LLC.

**Official URL:** afrojun.dev (verified site)

**Homepage:** https://afrojun.dev/profilebar/

**Support:** https://github.com/afrojun/profilebar/issues

**Privacy policy:**
https://github.com/afrojun/profilebar/blob/main/extension/PRIVACY.md

## Privacy

**Single purpose:** Open pages in the Chrome profile the user chooses, either
by moving tabs the user selects or by routing new tabs that match the user's
own rules, through the local ProfileBar app.

**Permission justifications:**

- `contextMenus`: Show the move actions and destination profiles in the page
  and tab right-click menus and the toolbar icon's menu, and **Always open this
  site in** on pages.
- `declarativeNetRequest`: Hold back the page load of a new tab that a
  link-routing rule assigns to another profile, so the site does not load in
  both profiles. The session rules come only from the user's link-routing rules
  and apply only to new tabs.
- `nativeMessaging`: Exchange the profile list and the selected URLs with the
  ProfileBar app on the same Mac, which opens the URLs in the chosen profile.
  When profiles share a name, the setup page also asks ProfileBar to open the
  chosen profile's settings so the user can rename it. Link routing keeps a
  connection to ProfileBar to receive the rules and to pass a new tab's URL to
  the profile its rule names, or to the profile the user chose for links from
  other apps that match no rule.
- `storage`: Remember which profile directory this copy of the extension runs
  in, so link routing knows which rules apply here.
- `tabs`: Read the URLs of the clicked, selected, or grouped tabs when the user
  chooses a move action, then close those tabs after a successful move. Read
  the first URL of each new tab to check it against the user's link-routing
  rules, and close it once another profile has opened it. Read the active
  tab's URL and group to show only the toolbar actions that apply, and which
  tabs share a split view so a split moves together. Tabs that were already
  open and navigation inside a tab are never read for link routing.
- `tabGroups`: Read the chosen group's title, colour, and collapsed state, then
  recreate them in the destination profile. Check whether the focused window
  has a tab group, without reading URLs, to show the group actions only when
  they apply.
- `webNavigation`: Tell link routing which new tabs a web page opened, so the
  user's **Web pages** setting applies to them and popup sign-in windows are
  left alone.

**Remote code:** No. All executable code is included in the extension package.

**Data handling:** The extension handles tab URLs, which are web browsing
activity. It reads selected tabs when the user chooses a move action, and the
first URL of new tabs to compare with the user's link-routing rules on the
device. It sends URLs only to the ProfileBar app on the same device, and only
for a move action, a rule that names another profile, or the profile the user
chose for links from other apps that match no rule. To show only the toolbar
actions that apply, it also checks the active tab's URL and group on the
device. Neither component retains them or collects other user data.

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
2. Install ProfileBar 1.6 or later from https://afrojun.dev/profilebar/ and
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
6. With the extension in two profiles, choose **Identify profiles** on the
   options page. Add the rule `example.com` for the other profile, then open
   `https://example.com` in a new tab. Confirm it opens in the other profile
   and the new tab closes.
7. In the first profile, type `https://example.com` into an existing tab's
   address bar, which link routing leaves alone. Close that tab and press
   Cmd+Shift+T. Confirm it reopens in the same profile.
8. Right-click the extension's toolbar icon on an HTTPS page. Confirm **Move
   tab to profile** and **Always open this site in** work, that **Move group to
   profile** appears only on a tab in a group, and that the destinations are
   greyed out on `chrome://extensions`.
9. In Chrome 155 or later, put two HTTPS tabs in a split view, right-click
   either half in the tab strip, and move it. Confirm both open side by side in
   the other profile.

Condensed version for the Dashboard:

> Needs macOS, two Chrome profiles, and ProfileBar 1.6+ from
> https://afrojun.dev/profilebar/ (open it once). Install the extension in both
> profiles and choose Identify profiles on its options page. Right-click a page,
> a tab, or the toolbar icon and choose Move tab to profile. Add the rule
> example.com for the other profile, then open https://example.com in a new tab:
> it opens there. A tab reopened with Cmd+Shift+T stays put. In Chrome 155+, a
> split view moved from the tab strip arrives split.

## Assets

- Store icon: `icons/icon-128.png`
- Lead screenshot (1280x800): `store-assets/move-tab.png`
- Setup screenshot (1280x800): `store-assets/setup.png`, the setup page in its connected state
- Small promo tile (440x280): `store-assets/small-promo.png`

The HTML sources sit next to the PNGs. Render them at 1x device pixel ratio
and the exact size above. The setup screenshot comes from `setup.html` with
`chrome.runtime.sendMessage` stubbed to return `{ state: "ready", destinationCount: 2 }`.
