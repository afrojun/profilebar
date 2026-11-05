const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const extensionRoot = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(extensionRoot, "background.js"), "utf8");
const extensionID = "abcdefghijklmnopabcdefghijklmnop";
const STARTUP_MS = 3000;

function menuHarness({
  installedFromStore = true, hostResponse = { ok: true, profiles: [] }, tabContext = true, os = "mac", focused = true,
  profileDirectory = null, settleStartup = true, leftoverRules = [], focusError = null, noWindow = false,
} = {}) {
  const listeners = { messageHandlers: [] };
  listeners.message = (message, sender, sendResponse) => listeners.messageHandlers
    .map((handler) => handler(message, sender, sendResponse)).some(Boolean);
  const clock = { now: 1_000_000, timers: [] };
  const ports = [];
  const ruleUpdates = [];
  const reloadedTabs = [];
  const windowUpdates = [];
  const tabUpdates = [];
  const windowTypes = new Map();
  let beforeWindowCheck = null;
  const storage = { profileDirectory };
  let nextTabId = 500;
  let nextUUID = 1;
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
  let pendingLastError = null;
  const chrome = {
    runtime: {
      id: extensionID,
      // Like Chrome, an error set for a callback counts as checked once the extension reads it.
      get lastError() {
        if (pendingLastError) pendingLastError.checked = true;
        return pendingLastError?.error;
      },
      getManifest() { return installedFromStore ? { update_url: "https://clients2.google.com/service/update2/crx" } : {}; },
      onInstalled: { addListener(listener) { listeners.installed = listener; } },
      onStartup: { addListener(listener) { listeners.startup = listener; } },
      onMessage: { addListener(listener) { listeners.messageHandlers.push(listener); } },
      connectNative(host) {
        const port = {
          host, messages: [], disconnected: false,
          onMessage: { addListener(listener) { port.receive = listener; } },
          onDisconnect: { addListener(listener) { port.drop = listener; } },
          postMessage(message) { port.messages.push(JSON.parse(JSON.stringify(message))); },
          disconnect() { port.disconnected = true; },
        };
        ports.push(port);
        return port;
      },
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
      WINDOW_ID_CURRENT: -2,
      onFocusChanged: { addListener(listener) { listeners.focusChanged = listener; } },
      async getLastFocused() {
        if (noWindow) throw new Error("No window");
        return { id: 1, focused: windowFocused, state: "normal" };
      },
      async get(id) {
        beforeWindowCheck?.();
        return { id, type: windowTypes.get(id) ?? "normal" };
      },
      async update(id, properties) {
        if (focusError) throw focusError;
        windowUpdates.push({ id, ...properties });
      },
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
      TAB_ID_NONE: -1,
      onAttached: { addListener(listener) { listeners.tabAttached = listener; } },
      onDetached: { addListener(listener) { listeners.tabDetached = listener; } },
      onCreated: { addListener(listener) { listeners.tabCreated = listener; } },
      onUpdated: { addListener(listener) { listeners.tabUpdated = listener; } },
      onRemoved: { addListener(listener) { listeners.tabRemoved = listener; } },
      async create(tab) {
        openedTabs.push(tab);
        const created = { id: nextTabId++, windowId: tab.windowId ?? 1, pendingUrl: tab.url };
        tabs.set(created.id, created);
        listeners.tabCreated?.(created);
        return created;
      },
      async reload(id) { reloadedTabs.push(id); },
      async update(id, properties) { tabUpdates.push({ id, ...properties }); },
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
      async query({ windowId }) {
        assert.equal(windowId, -2, "group visibility should follow the current window");
        return [...groups.values()].filter((group) => group.windowId === 1);
      },
      async get(id) {
        if (!groups.has(id)) throw new Error("Group not found");
        return groups.get(id);
      },
    },
  };
  chrome.storage = { local: {
    async get(key) { return { [key]: storage[key] }; },
    async set(values) { Object.assign(storage, values); },
  } };
  chrome.webNavigation = {
    onCreatedNavigationTarget: { addListener(listener) { listeners.navigationTarget = listener; } },
    onErrorOccurred: { addListener(listener) { listeners.navigationError = listener; } },
    onCommitted: { addListener(listener) { listeners.navigationCommitted = listener; } },
  };
  let sessionRules = leftoverRules;
  let ruleUpdateError = null;
  chrome.declarativeNetRequest = {
    async getSessionRules() { return sessionRules; },
    async updateSessionRules(update) {
      if (ruleUpdateError) throw ruleUpdateError;
      const kept = sessionRules.filter(({ id }) => !update.removeRuleIds.includes(id));
      if (update.addRules.some((rule) => kept.some(({ id }) => id === rule.id))) {
        throw new Error(`Rule with id ${update.addRules[0].id} does not have a unique ID.`);
      }
      sessionRules = [...kept, ...update.addRules];
      ruleUpdates.push(JSON.parse(JSON.stringify(update)));
    },
  };
  function advance(ms) {
    clock.now += ms;
    for (;;) {
      const due = clock.timers.filter((timer) => timer.at <= clock.now).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      clock.timers.splice(clock.timers.indexOf(due), 1);
      due.callback();
    }
  }
  const context = vm.createContext({
    chrome, TextEncoder, URL,
    console: { debug() {}, error(...args) { errors.push(args); } },
    Date: { now: () => clock.now },
    setTimeout(callback, ms) { clock.timers.push({ at: clock.now + ms, callback }); },
    crypto: { randomUUID: () => `rule-${nextUUID++}` },
    importScripts(...files) {
      for (const file of files) vm.runInContext(fs.readFileSync(path.join(extensionRoot, file), "utf8"), context);
    },
  });
  vm.runInContext(source, context);
  if (settleStartup) advance(STARTUP_MS);
  return {
    ports,
    ruleUpdates,
    reloadedTabs,
    windowUpdates,
    tabUpdates,
    storage,
    advance,
    setWindowType(id, type) { windowTypes.set(id, type); },
    onWindowCheck(callback) { beforeWindowCheck = callback; },
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
    // Closes the port the way Chrome does when ProfileBar exits, and reports whether the extension read the error.
    exitHost(port, message) {
      pendingLastError = { error: { message }, checked: false };
      port.drop();
      const { checked } = pendingLastError;
      pendingLastError = null;
      return checked;
    },
    setTab(tab) { tabs.set(tab.id, tab); },
    failRuleUpdates(error) { ruleUpdateError = error; },
    setGroup(group) { groups.set(group.id, group); },
    deleteGroup(id) { groups.delete(id); },
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
  harness.setGroup({ id: 3, windowId: 2 });
  await harness.refresh();
  assert.deepEqual(groupItemsVisible(), [false, false], "a group in another window should not count");

  harness.setGroup({ id: 7, windowId: 1 });
  harness.listeners.groupCreated({ id: 7, windowId: 1 });
  await harness.settle();
  assert.deepEqual(groupItemsVisible(), [true, true]);

  harness.deleteGroup(7);
  harness.listeners.groupRemoved({ id: 7, windowId: 1 });
  await harness.settle();
  assert.deepEqual(groupItemsVisible(), [false, false]);
  assert.equal(harness.nativeMessages.length, 1, "visibility changes must not contact ProfileBar");
});

test("profiles that share a name are labelled by folder and reported to the setup page", async () => {
  const harness = menuHarness({ hostResponse: { ok: true, profiles: [
    { directory: "Profile 3", name: "Taylor" },
    { directory: "Profile 5", name: "taylor" },
    { directory: "Profile 2", name: "Work" },
  ] } });
  const result = await vm.runInContext("buildProfileMenu()", harness.context);

  assert.deepEqual(JSON.parse(JSON.stringify(result.sharedNameProfiles)), [
    { directory: "Profile 3", name: "Taylor" },
    { directory: "Profile 5", name: "taylor" },
  ]);
  assert.deepEqual(harness.menus.filter((item) => item.id.startsWith("profile:")).map((item) => item.title), [
    "Taylor (Profile 3)", "taylor (Profile 5)", "Work",
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

  const stale = menuHarness({ hostResponse: { ok: false, error: "profile_not_found" } });
  stale.listeners.message({ type: "open-profile-settings", profileDirectory: "Profile 9" }, {}, (value) => { response = value; });
  await new Promise(setImmediate);
  assert.equal(response.result, "failed");
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

  assert.deepEqual(JSON.parse(JSON.stringify(response)), {
    state: "ready", destinationCount: 2, sharedNameProfiles: [],
    profiles: [{ directory: "Default", title: "Personal" }, { directory: "Profile 2", title: "Work" }],
  });
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

const flush = () => new Promise(setImmediate);
const plain = (value) => JSON.parse(JSON.stringify(value));
const workRules = {
  version: 1,
  routeFrom: { otherApps: true, webPages: true },
  rules: [
    { id: "a", kind: "host", host: "jira.example.com", pathPrefix: "", profileDirectory: "Profile 2" },
    { id: "b", kind: "host", host: "example.com", pathPrefix: "", profileDirectory: "Default" },
  ],
};

async function connectedRouter({ settings = workRules, ...options } = {}) {
  const harness = menuHarness({ profileDirectory: "Default", ...options });
  await flush();
  const port = harness.ports.at(-1);
  port.receive({ type: "settings", settings });
  await flush();
  return { harness, port };
}

function openExternalLink(harness, id, url, windowId = 1) {
  harness.setTab({ id, windowId, pendingUrl: url });
  harness.listeners.tabCreated({ id, windowId, pendingUrl: url });
}

function openFromPage(harness, id, url, windowId = 1) {
  harness.setTab({ id, windowId });
  harness.listeners.tabCreated({ id, windowId });
  harness.listeners.navigationTarget({ tabId: id, sourceTabId: 3, url });
}

const routeMessages = (port) => port.messages.filter((message) => message.type === "route");

test("a link from another app moves to the profile its rule names, then its tab closes", async () => {
  const { harness, port } = await connectedRouter();
  assert.deepEqual(port.messages[0], { type: "hello", profileDirectory: "Default" });
  const blocking = harness.ruleUpdates.at(-1).addRules;
  assert.deepEqual(blocking.map((rule) => [rule.condition.urlFilter ?? "sign-in", rule.action.type, rule.priority]), [
    ["||jira.example.com^", "block", 2], ["||example.com^", "allow", 1], ["sign-in", "allow", 3],
  ]);

  openExternalLink(harness, 9, "https://jira.example.com/browse/X-1");
  openExternalLink(harness, 10, "https://www.example.com/");
  await flush();
  assert.deepEqual(routeMessages(port), [{
    type: "route", requestId: 1, url: "https://jira.example.com/browse/X-1", profileDirectory: "Profile 2",
  }]);
  assert.deepEqual(harness.removedTabs, [], "the tab stays until the destination opens it");

  port.receive({ type: "routed", requestId: 1, ok: true, via: "relay" });
  await flush();
  assert.deepEqual(harness.removedTabs, [9]);
});

test("tabs that open while Chrome starts stay put, and manual moves wait for startup to end", async () => {
  const harness = menuHarness({ profileDirectory: "Default", settleStartup: false });
  await flush();
  const port = harness.ports.at(-1);
  port.receive({ type: "settings", settings: workRules });
  await flush();

  openExternalLink(harness, 9, "https://jira.example.com/restored");
  await flush();
  assert.deepEqual(routeMessages(port), []);
  assert.ok(harness.ruleUpdates.at(-1).addRules[0].condition.excludedTabIds.includes(9));

  harness.setTab({ id: 42, url: "https://example.org/" });
  harness.listeners.clicked(
    { menuItemId: "profile:Profile%202", pageUrl: "https://example.org/" }, { id: 42, url: "https://example.org/" });
  await flush();
  assert.equal(harness.nativeMessages.some(({ message }) => message.type === "openURL"), false);
  harness.advance(STARTUP_MS);
  await flush();
  assert.equal(harness.nativeMessages.at(-1).message.type, "openURL");
});

test("a reopened tab stays in its profile, and reloads if Chrome blocked it", async () => {
  const { harness, port } = await connectedRouter({ settings: { ...workRules, fallbackProfileDirectory: "Profile 3" } });
  // A restored tab already has the page it showed, and the one in front is loading it again.
  const reopened = { id: 25, windowId: 1, url: "https://jira.example.com/browse/X-4" };
  const loading = { id: 26, windowId: 1, url: "https://news.example.org/", pendingUrl: "https://news.example.org/" };
  for (const tab of [reopened, loading]) {
    harness.setTab(tab);
    harness.listeners.tabCreated(tab);
  }
  harness.listeners.navigationError({ tabId: 26, frameId: 0, error: "net::ERR_BLOCKED_BY_CLIENT" });
  await flush();
  assert.deepEqual(routeMessages(port), []);
  assert.deepEqual(harness.reloadedTabs, [26]);
  assert.ok([25, 26].every((id) => harness.ruleUpdates.at(-1).addRules[0].condition.excludedTabIds.includes(id)));
});

test("popup windows, such as sign-in windows, are never routed", async () => {
  const { harness, port } = await connectedRouter();
  harness.setWindowType(7, "popup");
  openFromPage(harness, 11, "https://jira.example.com/login", 7);
  await flush();
  assert.deepEqual(routeMessages(port), []);
});

test("a link opened into a split view stays beside its page", async () => {
  const { harness, port } = await connectedRouter();
  openFromPage(harness, 27, "https://jira.example.com/browse/X-5");
  harness.setTab({ id: 27, windowId: 1, splitViewId: 4 }); // Chrome joins the split before the router asks
  await flush();
  assert.deepEqual(routeMessages(port), []);
  assert.ok(harness.ruleUpdates.at(-1).addRules[0].condition.excludedTabIds.includes(27));
});

test("each source can be turned off, and a blocked tab from it reloads where it is", async () => {
  const { harness, port } = await connectedRouter({
    settings: { ...workRules, routeFrom: { otherApps: true, webPages: false } },
  });
  openFromPage(harness, 12, "https://jira.example.com/from-page");
  await flush();
  assert.deepEqual(routeMessages(port), []);
  harness.listeners.navigationError({ tabId: 12, frameId: 0, error: "net::ERR_BLOCKED_BY_CLIENT" });
  await flush();
  assert.deepEqual(harness.reloadedTabs, [12]);
  assert.ok(harness.ruleUpdates.at(-1).addRules[0].condition.excludedTabIds.includes(12));

  openExternalLink(harness, 13, "https://jira.example.com/from-app");
  await flush();
  assert.equal(routeMessages(port).length, 1, "links from other apps are still routed");
});

test("unmatched links from other apps open in the fallback profile, and links from pages stay", async () => {
  const { harness, port } = await connectedRouter({ settings: { ...workRules, fallbackProfileDirectory: "Profile 3" } });
  openExternalLink(harness, 20, "https://news.example.org/");
  openFromPage(harness, 21, "https://news.example.org/from-page");
  await flush();
  assert.deepEqual(routeMessages(port).map(({ url, profileDirectory }) => [url, profileDirectory]), [
    ["https://news.example.org/", "Profile 3"],
  ]);

  // Chrome can report the new tab before saying that a page opened it.
  harness.onWindowCheck(() => {
    harness.onWindowCheck(null);
    harness.listeners.navigationTarget({ tabId: 22, sourceTabId: 3, url: "https://news.example.org/late" });
  });
  openExternalLink(harness, 22, "https://news.example.org/late");
  await flush();
  assert.equal(routeMessages(port).length, 1, "a tab that a page opened stays even if Chrome names its source late");
});

test("the fallback profile keeps unmatched links, and a rule still wins over it", async () => {
  const { harness, port } = await connectedRouter({ settings: { ...workRules, fallbackProfileDirectory: "Default" } });
  openExternalLink(harness, 23, "https://news.example.org/");
  openExternalLink(harness, 24, "https://jira.example.com/browse/X-3");
  await flush();
  assert.deepEqual(routeMessages(port).map(({ url }) => url), ["https://jira.example.com/browse/X-3"]);
});

test("a restarted service worker replaces the rules its previous run left in Chrome", async () => {
  const leftoverRules = [{ id: 1 }, { id: 2 }];
  const { harness } = await connectedRouter({ leftoverRules });
  assert.deepEqual(harness.ruleUpdates.at(-1).removeRuleIds, [1, 2]);
  assert.ok(harness.ruleUpdates.at(-1).addRules.length > 0);
});

test("a failed route leaves the tab open and reloads it if Chrome blocked it", async () => {
  const { harness, port } = await connectedRouter();
  openExternalLink(harness, 14, "https://jira.example.com/browse/X-2");
  await flush();
  harness.listeners.navigationError({ tabId: 14, frameId: 0, error: "net::ERR_BLOCKED_BY_CLIENT" });
  port.receive({ type: "routed", requestId: 1, ok: false });
  await flush();
  assert.deepEqual(harness.removedTabs, []);
  assert.deepEqual(harness.reloadedTabs, [14]);
});

test("tabs that another profile sends here open in the last window and are never routed again", async () => {
  const { harness, port } = await connectedRouter();
  port.receive({ type: "open", requestId: "r1", urls: ["https://jira.example.com/moved"] });
  await flush();
  // The tab opens blank and loads its URL once request blocking skips it, so the page loads only once.
  assert.deepEqual(plain(harness.openedTabs.at(-1)), { windowId: 1, url: "about:blank", active: true });
  assert.ok(harness.ruleUpdates.at(-1).addRules.every((rule) => rule.condition.excludedTabIds.includes(500)));
  assert.deepEqual(plain(harness.tabUpdates.at(-1)), { id: 500, url: "https://jira.example.com/moved" });
  assert.deepEqual(plain(harness.windowUpdates.at(-1)), { id: 1, focused: true });
  assert.deepEqual(port.messages.at(-1), { type: "opened", requestId: "r1", ok: true, started: true });

  harness.listeners.tabUpdated(500, { url: "https://jira.example.com/moved" });
  await flush();
  assert.deepEqual(routeMessages(port), []);
});

test("an arrival that opened its tabs succeeds even if Chrome declines to focus the window", async () => {
  const { port } = await connectedRouter({ focusError: new Error("Cannot focus") });
  port.receive({ type: "open", requestId: "r2", urls: ["https://example.com/a"] });
  await flush();
  assert.deepEqual(port.messages.at(-1), { type: "opened", requestId: "r2", ok: true, started: true });
});

test("an arrival with no window to open in reports that nothing opened, so ProfileBar can open it another way",
  async () => {
    const { port } = await connectedRouter({ noWindow: true });
    port.receive({ type: "open", requestId: "r3", urls: ["https://example.com/a"] });
    await flush();
    assert.deepEqual(port.messages.at(-1), { type: "opened", requestId: "r3", ok: false, started: false });
  });

test("a blocked tab that the user navigates while it is routed stays open", async () => {
  const { harness, port } = await connectedRouter();
  openExternalLink(harness, 30, "https://jira.example.com/browse/X-4");
  await flush();
  harness.listeners.navigationError({ tabId: 30, frameId: 0, error: "net::ERR_BLOCKED_BY_CLIENT" });
  harness.setTab({ id: 30, windowId: 1, url: "https://example.org/elsewhere" });
  port.receive({ type: "routed", requestId: 1, ok: true });
  await flush();
  assert.deepEqual(harness.removedTabs, []);
  assert.deepEqual(harness.reloadedTabs, [], "the page the user went to is not reloaded");
});

test("an arrival fails without loading its page when Chrome rejects the request-blocking rules", async () => {
  const { harness, port } = await connectedRouter();
  harness.failRuleUpdates(new Error("Regular expression is too large"));
  port.receive({ type: "open", requestId: "r4", urls: ["https://example.com/a"] });
  await flush();
  assert.deepEqual(port.messages.at(-1), { type: "opened", requestId: "r4", ok: false, started: true });
  assert.deepEqual(harness.removedTabs, [500], "the blank tab closes");
  assert.equal(harness.tabUpdates.some(({ url }) => url === "https://example.com/a"), false);
  let state;
  harness.listeners.message({ type: "get-link-routing" }, {}, (value) => { state = value; });
  await flush();
  assert.match(state.ruleError, /^Chrome could not apply the link-routing rules/);
});

test("a page blocked by another extension is reloaded at most once", async () => {
  const { harness } = await connectedRouter();
  harness.setTab({ id: 31, windowId: 1, url: "https://ads.example/" });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    harness.listeners.navigationError({ tabId: 31, frameId: 0, error: "net::ERR_BLOCKED_BY_CLIENT" });
    await flush();
  }
  assert.deepEqual(harness.reloadedTabs, [31]);
});

test("navigation inside a fresh tab after its page shows is not routed, but an immediate redirect is", async () => {
  const { harness, port } = await connectedRouter();
  openExternalLink(harness, 32, "https://news.example.org/");
  harness.listeners.navigationCommitted({ tabId: 32, frameId: 0 });
  harness.listeners.tabUpdated(32, { url: "https://jira.example.com/redirected" });
  await flush();
  assert.equal(routeMessages(port).length, 1, "a redirect within a moment of the page showing is routed");

  openExternalLink(harness, 33, "https://news.example.org/");
  harness.listeners.navigationCommitted({ tabId: 33, frameId: 0 });
  harness.advance(1000);
  harness.listeners.tabUpdated(33, { url: "https://jira.example.com/clicked" });
  await flush();
  assert.equal(routeMessages(port).length, 1, "a link the user follows later stays in the tab");
});

test("sign-in sites are never routed, even to the fallback profile", async () => {
  const { harness, port } = await connectedRouter({
    settings: { ...workRules, fallbackProfileDirectory: "Profile 3" },
  });
  openExternalLink(harness, 34, "https://accounts.google.com/signin");
  await flush();
  assert.deepEqual(routeMessages(port), []);
});

test("identifying profiles brings the asking tab back to the front", async () => {
  const harness = menuHarness({ hostResponse: { ok: true, identified: ["Default", "Profile 2"], unreachable: [] } });
  let result;
  harness.listeners.message({ type: "identify-profiles" }, { tab: { id: 7, windowId: 3 } }, (value) => { result = value; });
  await flush();
  assert.deepEqual(plain(result), { ok: true, identified: ["Default", "Profile 2"], unreachable: [] });
  assert.deepEqual(plain(harness.windowUpdates.at(-1)), { id: 3, focused: true });
  assert.deepEqual(plain(harness.tabUpdates.at(-1)), { id: 7, active: true });
});

test("an older ProfileBar turns routing off until it is updated", async () => {
  const harness = menuHarness({ profileDirectory: "Default" });
  await flush();
  const port = harness.ports.at(-1);
  port.receive({ ok: false, error: "invalid_request" });
  port.drop();
  let state;
  harness.listeners.message({ type: "get-link-routing" }, {}, (value) => { state = value; });
  await flush();
  assert.equal(state.status, "update-required");
  assert.deepEqual(harness.ruleUpdates.at(-1).addRules, []);
  harness.advance(1000);
  await flush();
  assert.equal(harness.ports.length, 2, "it checks again later in case ProfileBar was updated");
});

test("ProfileBar exiting is handled quietly and routing reconnects", async () => {
  const harness = menuHarness({ profileDirectory: "Default" });
  await flush();
  const checked = harness.exitHost(harness.ports.at(-1), "Native host has exited.");
  assert.equal(checked, true, "an unread error shows on the extension's Errors page");
  harness.advance(1000);
  await flush();
  assert.equal(harness.ports.length, 2);
});

test("a newly identified profile reconnects with its directory", async () => {
  const harness = menuHarness();
  await flush();
  assert.deepEqual(harness.ports[0].messages[0], { type: "hello", profileDirectory: null });
  harness.listeners.message({ type: "profile-identified", profileDirectory: "Profile 3" }, {}, () => {});
  await flush();
  assert.equal(harness.storage.profileDirectory, "Profile 3");
  assert.equal(harness.ports[0].disconnected, true);
  assert.deepEqual(harness.ports.at(-1).messages[0], { type: "hello", profileDirectory: "Profile 3" });
});

test("always opening a site in a profile saves a host rule and moves the page there", async () => {
  const { harness } = await connectedRouter({ hostResponse: { ok: true, profiles: [
    { directory: "Default", name: "Personal" }, { directory: "Profile 2", name: "Work" },
  ] } });
  await harness.refresh();
  assert.deepEqual(
    harness.menus.filter((item) => item.parentId === "always-open-site").map((item) => item.title),
    ["Personal", "Work"],
  );

  harness.setTab({ id: 42, url: "https://wiki.example.org/page" });
  harness.listeners.clicked(
    { menuItemId: "always:Profile%202", pageUrl: "https://wiki.example.org/page" },
    { id: 42, url: "https://wiki.example.org/page" },
  );
  await flush();
  const saved = harness.nativeMessages.find(({ message }) => message.type === "saveLinkRouting").message;
  assert.deepEqual(plain(saved.settings.rules.at(-1)), {
    id: "rule-1", kind: "host", host: "wiki.example.org", pathPrefix: "", profileDirectory: "Profile 2",
  });
  assert.equal(harness.nativeMessages.at(-1).message.type, "openURL");
  assert.deepEqual(harness.removedTabs, [42]);
});
