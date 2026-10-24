const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
const extensionID = "abcdefghijklmnopabcdefghijklmnop";

function menuHarness({ installedFromStore = true, hostResponse = { ok: true, profiles: [] }, tabContext = true, os = "mac", focused = true } = {}) {
  const listeners = {};
  const menus = [];
  const nativeMessages = [];
  const openedTabs = [];
  const removedTabs = [];
  const errors = [];
  const tabs = new Map();
  const groups = new Map();
  let optionsOpened = 0;
  let windowFocused = focused;
  let groupResponse;
  let nativeError;
  let closeError;
  let openGate;
  const chrome = {
    runtime: {
      id: extensionID,
      getManifest() { return installedFromStore ? { update_url: "https://clients2.google.com/service/update2/crx" } : {}; },
      onInstalled: { addListener(listener) { listeners.installed = listener; } },
      onStartup: { addListener(listener) { listeners.startup = listener; } },
      onMessage: { addListener(listener) { listeners.message = listener; } },
      async openOptionsPage() { optionsOpened += 1; },
      getURL(file) { return `chrome-extension://${extensionID}/${file}`; },
      async getPlatformInfo() { return { os }; },
      async sendNativeMessage(host, message) {
        nativeMessages.push({ host, message });
        if (nativeError) throw nativeError;
        if (["openURL", "openURLs", "openGroup"].includes(message.type) && openGate) await openGate;
        return message.type === "openGroup" ? groupResponse ?? hostResponse : hostResponse;
      },
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: { addListener(listener) { listeners.focusChanged = listener; } },
      async getLastFocused() { return { focused: windowFocused }; },
    },
    contextMenus: {
      ContextType: tabContext ? { TAB: "tab" } : {},
      onClicked: { addListener(listener) { listeners.clicked = listener; } },
      removeAll(callback) { menus.length = 0; callback(); },
      create(item, callback) { menus.push(item); callback(); },
      update(id, properties, callback) {
        Object.assign(menus.find((item) => item.id === id), properties);
        callback();
      },
    },
    tabs: {
      onAttached: { addListener(listener) { listeners.tabAttached = listener; } },
      onDetached: { addListener(listener) { listeners.tabDetached = listener; } },
      async create(tab) { openedTabs.push(tab); },
      async query({ active, highlighted, groupId, windowId }) {
        return [...tabs.values()].filter((tab) => (!active || tab.active) && (!highlighted || tab.highlighted)
          && (groupId === undefined || tab.groupId === groupId)
          && (windowId === undefined || tab.windowId === windowId));
      },
      async get(id) {
        if (!tabs.has(id)) throw new Error("Tab not found");
        return tabs.get(id);
      },
      async remove(ids) {
        if (closeError) throw closeError;
        for (const id of Array.isArray(ids) ? ids : [ids]) {
          removedTabs.push(id);
          tabs.delete(id);
        }
      },
    },
    tabGroups: {
      onCreated: { addListener(listener) { listeners.groupCreated = listener; } },
      onRemoved: { addListener(listener) { listeners.groupRemoved = listener; } },
      async get(id) {
        if (!groups.has(id)) throw new Error("Group not found");
        return groups.get(id);
      },
    },
  };
  const context = vm.createContext({
    chrome, TextEncoder,
    console: { debug() {}, error(...args) { errors.push(args); } },
  });
  vm.runInContext(source, context);
  return {
    listeners,
    menus,
    nativeMessages,
    openedTabs,
    removedTabs,
    errors,
    get optionsOpened() { return optionsOpened; },
    refresh: () => vm.runInContext("refreshProfileMenu()", context),
    settle: () => vm.runInContext("menuRefresh", context),
    context,
    setFocused(value) { windowFocused = value; },
    setNativeError(error) { nativeError = error; },
    setCloseError(error) { closeError = error; },
    setOpenGate(gate) { openGate = gate; },
    setTab(tab) { tabs.set(tab.id, tab); },
    setGroup(group) { groups.set(group.id, group); },
    setGroupResponse(response) { groupResponse = response; },
  };
}

test("first install opens the setup page", async () => {
  const harness = menuHarness();
  harness.listeners.installed({ reason: "install" });
  harness.listeners.installed({ reason: "update" });
  await new Promise(setImmediate);
  assert.equal(harness.optionsOpened, 1);
});

test("a missing ProfileBar shows setup and keeps a page fallback", async () => {
  const harness = menuHarness({ tabContext: false });
  harness.setNativeError(new Error("Specified native messaging host not found"));
  await harness.refresh();

  assert.deepEqual(harness.menus.map((item) => item.id), [
    "move-to-profile", "setup-profilebar", "profiles-refresh-divider", "refresh-profiles",
  ]);
  assert.equal(harness.menus[0].contexts.join(","), "page");
  harness.listeners.clicked({ menuItemId: "setup-profilebar" });
  assert.equal(harness.optionsOpened, 1);
});

test("a verified focused profile is omitted from both destination menus", async () => {
  const harness = menuHarness({ hostResponse: {
    ok: true,
    profiles: [
      { directory: "Default", name: "Personal" },
      { directory: "Profile 2", name: "Work" },
    ],
    focusedProfileDirectory: "Profile 2",
  } });
  await harness.refresh();
  assert.deepEqual(harness.menus.filter((item) => item.id.startsWith("profile:")).map((item) => item.title), ["Personal"]);
  assert.deepEqual(harness.menus.filter((item) => item.id.startsWith("tab:profile:")).map((item) => item.title), ["Move tab to Personal"]);
  assert.deepEqual(harness.menus.filter((item) => item.id.startsWith("group:profile:")).map((item) => item.title), ["Move group to Personal"]);

  harness.setFocused(false);
  harness.listeners.focusChanged(-1);
  await new Promise(setImmediate);
  assert.equal(harness.menus.filter((item) => item.id.startsWith("profile:")).length, 2);
  assert.equal(harness.menus.filter((item) => item.id.startsWith("tab:profile:")).length, 2);
});

test("group moves appear only while the focused window has a group", async () => {
  const harness = menuHarness({ hostResponse: { ok: true, profiles: [{ directory: "Profile 2", name: "Work" }] } });
  const groupItemsVisible = () => harness.menus
    .filter((item) => item.id === "tab:group-divider" || item.id.startsWith("group:"))
    .map((item) => item.visible);
  harness.setTab({ id: 1, windowId: 1, groupId: -1 });
  await harness.refresh();
  assert.deepEqual(groupItemsVisible(), [false, false]);

  harness.setTab({ id: 2, windowId: 1, groupId: 7 });
  harness.listeners.groupCreated({ id: 7, windowId: 1 });
  await harness.settle();
  assert.deepEqual(groupItemsVisible(), [true, true]);

  harness.setTab({ id: 2, windowId: 1, groupId: -1 });
  harness.listeners.groupRemoved({ id: 7, windowId: 1 });
  await harness.settle();
  assert.deepEqual(groupItemsVisible(), [false, false]);
  assert.equal(harness.nativeMessages.length, 1, "visibility changes must not contact ProfileBar");
});

test("profiles that share a name are labelled by folder and reported to the setup page", async () => {
  const harness = menuHarness({ hostResponse: { ok: true, profiles: [
    { directory: "Profile 3", name: "Taylor" },
    { directory: "Profile 5", name: "Taylor" },
    { directory: "Profile 2", name: "Work" },
  ] } });
  const result = await vm.runInContext("buildProfileMenu()", harness.context);

  assert.deepEqual(JSON.parse(JSON.stringify(result.sharedNameProfiles)), [
    { directory: "Profile 3", name: "Taylor" },
    { directory: "Profile 5", name: "Taylor" },
  ]);
  assert.deepEqual(harness.menus.filter((item) => item.id.startsWith("profile:")).map((item) => item.title), [
    "Taylor (Profile 3)", "Taylor (Profile 5)", "Work",
  ]);
});

test("the setup page can ask ProfileBar to open another profile's settings", async () => {
  const harness = menuHarness({ hostResponse: { ok: true, opened: true } });
  const ask = async (message) => {
    let response;
    assert.equal(harness.listeners.message(message, {}, (value) => { response = value; }), true);
    await new Promise(setImmediate);
    return response.result;
  };

  assert.equal(await ask({ type: "open-profile-settings", profileDirectory: "Profile 5" }), "opened");
  assert.deepEqual(JSON.parse(JSON.stringify(harness.nativeMessages.at(-1))), {
    host: "dev.afrojun.profilebar", message: { type: "openProfileSettings", profileDirectory: "Profile 5" },
  });
  assert.equal(harness.listeners.message({ type: "open-profile-settings" }, {}, () => {}), false);

  const missing = menuHarness({ hostResponse: { ok: true, opened: false } });
  let response;
  missing.listeners.message({ type: "open-profile-settings", profileDirectory: "Profile 5" }, {}, (value) => { response = value; });
  await new Promise(setImmediate);
  assert.equal(response.result, "extension-missing");

  const older = menuHarness({ hostResponse: { ok: false, error: "invalid_request" } });
  older.listeners.message({ type: "open-profile-settings", profileDirectory: "Profile 5" }, {}, (value) => { response = value; });
  await new Promise(setImmediate);
  assert.equal(response.result, "update-required");
});

test("one known profile leaves refresh available", async () => {
  const harness = menuHarness({ hostResponse: {
    ok: true,
    profiles: [{ directory: "Default", name: "Personal" }],
    focusedProfileDirectory: "Default",
  } });
  await harness.refresh();
  assert.ok(harness.menus.some((item) => item.id === "no-profiles" && item.enabled === false));
  assert.ok(harness.menus.some((item) => item.id === "tab:refresh-profiles"));
  assert.ok(!harness.menus.some((item) => item.id.startsWith("tab:profile:")));
});

test("the setup page check refreshes the menu and reports the connection", async () => {
  const harness = menuHarness({ hostResponse: {
    ok: true,
    profiles: [{ directory: "Default", name: "Personal" }, { directory: "Profile 2", name: "Work" }],
  } });
  let response;
  assert.equal(harness.listeners.message({ type: "check-profilebar" }, {}, (value) => { response = value; }), true);
  await new Promise(setImmediate);

  assert.deepEqual(JSON.parse(JSON.stringify(response)), { state: "ready", destinationCount: 2, sharedNameProfiles: [] });
  assert.ok(harness.menus.some((item) => item.id === "profile:Default"));
  assert.equal(harness.listeners.message({ type: "other" }, {}, () => {}), false);
});

test("non-macOS users see availability without contacting ProfileBar", async () => {
  const harness = menuHarness({ os: "win" });
  await harness.refresh();
  assert.ok(harness.menus.some((item) => item.id === "mac-only" && item.enabled === false));
  assert.ok(!harness.menus.some((item) => item.id === "refresh-profiles"));
  assert.equal(harness.nativeMessages.length, 0);
});

test("a successful handoff closes the clicked tab after opening it in the selected profile", async () => {
  const harness = menuHarness({
    hostResponse: { ok: true, profiles: [
      { directory: "Default", name: "Work" },
      { directory: "Profile 2", name: "Work" },
    ] },
  });
  await harness.refresh();

  const profiles = harness.menus.filter((item) => item.id.startsWith("profile:"));
  assert.deepEqual(profiles.map((item) => item.title), ["Work (Default)", "Work (Profile 2)"]);
  assert.equal(harness.menus[0].contexts.join(","), "page");
  const tabRoot = harness.menus.find((item) => item.id === "tab-actions");
  assert.equal(tabRoot.title, "Move tabs to profile");
  assert.equal(tabRoot.contexts.join(","), "tab");
  assert.ok(harness.menus.filter((item) => item.contexts.join(",") === "tab")
    .every((item) => item.id === tabRoot.id || item.parentId === tabRoot.id));
  assert.deepEqual(harness.menus.filter((item) => item.id.startsWith("tab:profile:")).map((item) => item.title), [
    "Move tab to Work (Default)", "Move tab to Work (Profile 2)",
  ]);
  assert.deepEqual(harness.menus.filter((item) => item.id.startsWith("group:profile:")).map((item) => item.title), [
    "Move group to Work (Default)", "Move group to Work (Profile 2)",
  ]);
  const tabItems = harness.menus.filter((item) => item.contexts.join(",") === "tab");
  assert.deepEqual(tabItems.map((item) => item.id), [
    "tab-actions",
    "tab:profile:Default", "tab:profile:Profile%202", "tab:group-divider",
    "group:profile:Default", "group:profile:Profile%202",
    "tab:profiles-refresh-divider", "tab:refresh-profiles",
  ]);
  for (const divider of tabItems.filter((item) => item.id.endsWith("-divider"))) {
    assert.equal(divider.enabled, false);
    assert.equal(divider.title, "───────");
    assert.equal(divider.parentId, tabRoot.id);
  }

  harness.setTab({ id: 42, url: "https://example.com/from-tab" });
  harness.listeners.clicked(
    { menuItemId: "profile:Profile%202", pageUrl: "https://example.com/from-tab" },
    { id: 42, url: "https://example.com/from-tab" },
  );
  await new Promise(setImmediate);
  assert.equal(harness.nativeMessages.at(-1).host, "dev.afrojun.profilebar");
  assert.equal(harness.nativeMessages.at(-1).message.type, "openURL");
  assert.equal(harness.nativeMessages.at(-1).message.profileDirectory, "Profile 2");
  assert.equal(harness.nativeMessages.at(-1).message.url, "https://example.com/from-tab");
  assert.equal(harness.openedTabs.length, 0);
  assert.deepEqual(harness.removedTabs, [42]);
});

test("the source tab stays open until ProfileBar confirms the handoff", async () => {
  const harness = menuHarness();
  let confirmOpen;
  harness.setOpenGate(new Promise((resolve) => { confirmOpen = resolve; }));
  harness.setTab({ id: 42, url: "https://example.com/" });
  harness.listeners.clicked(
    { menuItemId: "profile:Default", pageUrl: "https://example.com/" },
    { id: 42, url: "https://example.com/" },
  );
  await new Promise(setImmediate);
  assert.deepEqual(harness.removedTabs, []);
  confirmOpen();
  await new Promise(setImmediate);
  assert.deepEqual(harness.removedTabs, [42]);
});

test("missing helper and unsupported pages leave the source tab in place", async () => {
  const harness = menuHarness();
  harness.setNativeError(new Error("Specified native messaging host not found"));
  await harness.refresh();
  assert.ok(harness.menus.some((item) => item.id === "setup-profilebar"));

  harness.setTab({ id: 42, url: "chrome://settings" });
  harness.listeners.clicked({ menuItemId: "profile:Default", pageUrl: "chrome://settings" }, { id: 42 });
  await new Promise(setImmediate);
  assert.equal(harness.openedTabs.length, 1);
  assert.match(harness.openedTabs[0].url, /unsupported-url$/);
  assert.equal(harness.nativeMessages.length, 1);
  assert.deepEqual(harness.removedTabs, []);
});

test("a changed source tab remains open after the destination opens", async () => {
  const harness = menuHarness();
  harness.setTab({ id: 42, url: "https://example.com/next" });
  harness.listeners.clicked(
    { menuItemId: "profile:Default", pageUrl: "https://example.com/original" },
    { id: 42, url: "https://example.com/original" },
  );
  await new Promise(setImmediate);
  assert.deepEqual(harness.removedTabs, []);
  assert.match(harness.openedTabs[0].url, /source-changed$/);
});

test("an unidentified source tab is not opened elsewhere", async () => {
  const harness = menuHarness();
  harness.listeners.clicked({ menuItemId: "profile:Default", pageUrl: "https://example.com/" });
  await new Promise(setImmediate);
  assert.deepEqual(harness.removedTabs, []);
  assert.equal(harness.nativeMessages.length, 0);
  assert.match(harness.openedTabs[0].url, /source-unavailable$/);
});

test("a failed handoff leaves the source tab in place", async () => {
  const harness = menuHarness();
  harness.setNativeError(new Error("ProfileBar unavailable"));
  harness.setTab({ id: 42, url: "https://example.com/" });
  harness.listeners.clicked(
    { menuItemId: "profile:Default", pageUrl: "https://example.com/" },
    { id: 42, url: "https://example.com/" },
  );
  await new Promise(setImmediate);
  assert.deepEqual(harness.removedTabs, []);
  assert.match(harness.openedTabs[0].url, /profilebar-unavailable$/);
});

test("a close failure reports that the destination opened and source remains", async () => {
  const harness = menuHarness();
  harness.setCloseError(new Error("Could not close tab"));
  harness.setTab({ id: 42, url: "https://example.com/" });
  harness.listeners.clicked(
    { menuItemId: "profile:Default", pageUrl: "https://example.com/" },
    { id: 42, url: "https://example.com/" },
  );
  await new Promise(setImmediate);
  assert.deepEqual(harness.removedTabs, []);
  assert.match(harness.openedTabs[0].url, /close-failed$/);
  assert.equal(harness.errors.length, 1);
});

test("a malformed profile list shows the setup action", async () => {
  const harness = menuHarness({ hostResponse: { ok: true, profiles: [null] } });
  await harness.refresh();
  assert.ok(harness.menus.some((item) => item.id === "setup-profilebar"));
});

test("a tab-menu move opens all highlighted tabs in strip order, then closes them together", async () => {
  const harness = menuHarness();
  harness.setTab({ id: 2, windowId: 7, index: 1, highlighted: true, url: "https://example.com/second" });
  harness.setTab({ id: 1, windowId: 7, index: 0, highlighted: true, url: "https://example.com/first" });
  harness.setTab({ id: 3, windowId: 8, index: 0, highlighted: true, url: "https://example.com/other-window" });
  harness.listeners.clicked({ menuItemId: "tab:profile:Default" }, { id: 2, windowId: 7 });
  await new Promise(setImmediate);

  assert.equal(harness.nativeMessages.at(-1).message.type, "openURLs");
  assert.deepEqual(Array.from(harness.nativeMessages.at(-1).message.urls), [
    "https://example.com/first", "https://example.com/second",
  ]);
  assert.deepEqual(harness.removedTabs, [1, 2]);
});


test("a group move preserves its metadata and reports the ungrouped fallback", async () => {
  const harness = menuHarness();
  harness.setGroup({ id: 8, windowId: 7, title: "Research", color: "blue", collapsed: true });
  harness.setTab({ id: 2, windowId: 7, groupId: 8, index: 1, url: "https://example.com/second" });
  harness.setTab({ id: 1, windowId: 7, groupId: 8, index: 0, url: "https://example.com/first" });
  harness.setGroupResponse({ ok: true, grouped: false });

  harness.listeners.clicked({ menuItemId: "group:profile:Default" }, { id: 2, windowId: 7, groupId: 8 });
  await new Promise(setImmediate);

  assert.equal(harness.nativeMessages.at(-1).message.type, "openGroup");
  assert.deepEqual(Array.from(harness.nativeMessages.at(-1).message.urls), [
    "https://example.com/first", "https://example.com/second",
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.nativeMessages.at(-1).message.group)), {
    title: "Research", color: "blue", collapsed: true,
  });
  assert.deepEqual(harness.removedTabs, [1, 2]);
  assert.match(harness.openedTabs[0].url, /group-opened-ungrouped$/);
});

test("a changed group stays open after its destination is created", async () => {
  const harness = menuHarness();
  let confirmOpen;
  harness.setOpenGate(new Promise((resolve) => { confirmOpen = resolve; }));
  harness.setGroup({ id: 8, windowId: 7, title: "Research", color: "blue", collapsed: false });
  harness.setTab({ id: 1, windowId: 7, groupId: 8, index: 0, url: "https://example.com/first" });
  harness.setTab({ id: 2, windowId: 7, groupId: 8, index: 1, url: "https://example.com/second" });
  harness.setGroupResponse({ ok: true, grouped: true });
  harness.listeners.clicked({ menuItemId: "group:profile:Default" }, { id: 1, windowId: 7, groupId: 8 });
  await new Promise(setImmediate);
  harness.setTab({ id: 3, windowId: 7, groupId: 8, index: 2, url: "https://example.com/third" });
  confirmOpen();
  await new Promise(setImmediate);

  assert.deepEqual(harness.removedTabs, []);
  assert.match(harness.openedTabs[0].url, /source-changed$/);
});

test("one unsupported selected URL aborts the entire move", async () => {
  const harness = menuHarness();
  harness.setTab({ id: 1, windowId: 7, index: 0, highlighted: true, url: "https://example.com/" });
  harness.setTab({ id: 2, windowId: 7, index: 1, highlighted: true, url: "chrome://settings" });
  harness.listeners.clicked({ menuItemId: "tab:profile:Default" }, { id: 1, windowId: 7 });
  await new Promise(setImmediate);

  assert.equal(harness.nativeMessages.length, 0);
  assert.deepEqual(harness.removedTabs, []);
  assert.match(harness.openedTabs[0].url, /unsupported-url$/);
});

test("a source change during a batch handoff leaves all originals open", async () => {
  const harness = menuHarness();
  let confirmOpen;
  harness.setOpenGate(new Promise((resolve) => { confirmOpen = resolve; }));
  harness.setTab({ id: 1, windowId: 7, index: 0, highlighted: true, url: "https://example.com/first" });
  harness.setTab({ id: 2, windowId: 7, index: 1, highlighted: true, url: "https://example.com/second" });
  harness.listeners.clicked({ menuItemId: "tab:profile:Default" }, { id: 1, windowId: 7 });
  await new Promise(setImmediate);
  harness.setTab({ id: 2, windowId: 7, index: 1, highlighted: true, url: "https://example.com/changed" });
  confirmOpen();
  await new Promise(setImmediate);

  assert.deepEqual(harness.removedTabs, []);
  assert.match(harness.openedTabs[0].url, /source-changed$/);
});

test("an older ProfileBar helper cannot close any selected tabs", async () => {
  const harness = menuHarness({ hostResponse: { ok: false, error: "invalid_request" } });
  harness.setTab({ id: 1, windowId: 7, index: 0, highlighted: true, url: "https://example.com/first" });
  harness.setTab({ id: 2, windowId: 7, index: 1, highlighted: true, url: "https://example.com/second" });
  harness.listeners.clicked({ menuItemId: "tab:profile:Default" }, { id: 1, windowId: 7 });
  await new Promise(setImmediate);

  assert.deepEqual(harness.removedTabs, []);
  assert.match(harness.openedTabs[0].url, /profilebar-update-required$/);
});

test("an unpacked build talks to the ProfileBar Dev helper", async () => {
  const harness = menuHarness({ installedFromStore: false });
  await harness.refresh();
  assert.equal(harness.nativeMessages[0].host, "dev.afrojun.profilebar.dev");
});
