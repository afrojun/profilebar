---
name: live-extension-check
description: Live check of ProfileBar for Chrome in the user's running Chrome, across real profiles. Use after changing the extension or the native helper, to verify moves, link routing, arrivals, or split views end to end before handing back.
---

# Live extension check

A live check runs the dev extension's real code in the user's own Chrome profiles through the `chrome-live` MCP server, and observes the result in every profile. Unit tests cover logic. A live check covers Chrome's own behaviour, such as event order and tab state, and ProfileBar Dev's relay between profiles.

Drive Chrome only through the `chrome-live` tools. They show the user each connection and stay inside Chrome's DevTools protocol. Touch only tabs you created, each tagged with `?pbtest=` in its URL. Keep Chrome running for the whole check, because a restart or session restore while routing is active makes Chrome skip a profile's restored tabs.

## 1. Connect

`chrome-live` is a local name for Google's public [Chrome DevTools MCP server](https://github.com/ChromeDevTools/chrome-devtools-mcp), started with two options. `--autoConnect` attaches to the user's running Chrome 144 or later instead of launching a separate one, and `--categoryExtensions` adds extension service workers and `chrome-extension://` pages. Any MCP client can run it. The tools are present when `list_pages` exists and lists **Extension Service Workers**. If they are missing:

- Register the server once per machine. In Claude Code: `claude mcp add -s user chrome-live -- npx chrome-devtools-mcp@1.11.0 --autoConnect --categoryExtensions`. Other clients take the same command and arguments in their MCP settings. A new server loads only when the session restarts, so ask the user to restart.
- Chrome's remote debugging is on when `~/Library/Application Support/Google/Chrome/DevToolsActivePort` exists. Otherwise ask the user to turn it on at `chrome://inspect/#remote-debugging`. They click **Allow** when the server connects.

Done when `list_pages` ends with an **Extension Service Workers** list.

## 2. Load the code under test

Build the dev extension (`python3 scripts/build-dev.py` in `extension/`) and, when the change touches the native helper, install ProfileBar Dev from the same source (`./build.sh --dev`, then replace `/Applications/ProfileBar Dev.app` after moving the old copy to `~/.backup`). Chrome loads the dev extension from `extension/dist/profilebar-for-chrome-dev` in the main checkout, so a build from a worktree must be copied there. To test several branches together, merge them in a scratch checkout and copy that build.

Run `evaluate_script` with `serviceWorkerId` on each worker whose `chrome.runtime.getManifest().name` is `ProfileBar for Chrome Dev`, calling `setTimeout(() => chrome.runtime.reload(), 100)`. Worker IDs change after a reload, so call `list_pages` again.

Done when every dev worker reports `routing.status === "connected"` and shows evidence that it runs the build under test, such as a function or global the change adds, or a changed value it reads.

## 3. Map the profiles

Evaluate `routing.profileDirectory` in each dev worker and note which worker serves which profile. Pick a source and a destination profile.

## 4. Add a throwaway rule

Copy `~/Library/Application Support/ProfileBar Dev/link-routing.json` to `~/.backup/link-routing.before-live-check.json`. In the source worker, return `JSON.stringify(routing.settings)` and keep it as the saved settings, because `addSiteRule` replaces any existing rule for the same host. Then run `addSiteRule("https://example.com/", "<destination>")` and check that it returns `{ ok: true }`.

## 5. Run the checks

Each check acts in the source worker and observes with `chrome.tabs.query({ url: "https://example.com/?pbtest=*" })` in every affected profile's worker. Wait a few seconds after each action for routing and arrivals to finish.

- **Tab kinds.** `chrome.tabs.create({ url })` is routed like a link from another app, which makes it the baseline check. A tab that should stay put is a **settled** tab: create it at `about:blank`, wait more than 5 seconds, then load its URL with `chrome.tabs.update`.
- **Moves.** `moveToProfile(directory, { menuItemId }, tab, mode)` runs the menu code, with `mode` set to `"page"`, `"tab"`, or `"group"` and `tab` read fresh with `chrome.tabs.get`.
- **Split views.** `chrome.tabs.createSplit([a, b])` splits two neighbouring tabs, and `chrome.tabs.create({ url, splitWithTabId })` opens a tab into a split, as "Open link in split view" does.
- **Event shapes.** When a change depends on what Chrome reports, add a temporary `chrome.tabs.onCreated` listener around the action and return what it saw. Remove the listener afterwards.
- **Reopened tabs.** `chrome.tabs.duplicate(id)` stands in for Cmd+Shift+T, because it is rebuilt from the same saved history.

Done when every behaviour the change touches has a check with an observed result in both profiles.

## 6. Clean up

Close every `?pbtest=` tab in every profile. In the source worker, restore the saved settings with `saveLinkRouting(<saved settings>)` and check that it returns `{ ok: true }`. Compare the rules file with the backup.

Done when no `?pbtest=` tab remains in any profile and the rules file matches the backup.

## 7. Report

List each check with its observed result, and hand the user what no tool can reach:

- browser shortcuts such as Cmd+Shift+T, which Chrome ignores when DevTools sends them
- the toolbar icon's menu and the tab strip's context menu, which only a person can open
