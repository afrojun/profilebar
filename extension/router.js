// Routes new tabs to the profile that the user's link-routing rules name, and serves the options page's rule editing
// and profile identification. The service worker loads this file after background.js defines NATIVE_HOST. See
// docs/link-routing-design.md for the design and its safeguards.
const FRESH_TAB_MS = 5000;
const MAX_FRESH_URL_CHANGES = 3;
// A client redirect follows its page within moments, but a person needs longer to read the page and click a link.
// ponytail: a timing heuristic, track navigation transitions if a slow redirect page needs routing.
const REDIRECT_WINDOW_MS = 1000;
// Chrome restores tabs while the extension starts, and a profile that receives URLs before Chrome restores it
// loses its restored tabs. So nothing is routed or sent to ProfileBar during this period.
const STARTUP_MS = 3000;
const UPDATE_REQUIRED = { ok: false, error: "update-required", message: "Update ProfileBar to use link routing." };
const routerStartedAt = Date.now();

// status is "connecting", "connected", "update-required" (an older ProfileBar), or "unavailable".
// ruleError says that Chrome rejected the request-blocking rules, which leaves the previous ones in place.
const routing = { status: "connecting", profileDirectory: null, settings: null, settingsError: null, ruleError: null };
let routingPort = null;
let reconnectDelay = 1000;
let nextRouteRequest = 1;
const routeRequests = new Map(); // request ID -> { tabId, url }
// A fresh tab may still be routed. source is "otherApps", "webPages", or null until Chrome says which. phase is
// "watching", "deciding" while its window type is checked, or "routing" while ProfileBar opens it elsewhere.
const freshTabs = new Map(); // tab ID -> { source, urlChanges, phase, blocked, committed }
const settledTabs = new Set(); // tabs that are no longer fresh, which request blocking skips
const reloadedTabs = new Set(); // tabs reloaded after a block, which are never reloaded again
let ruleUpdate = Promise.resolve();

const routerReady = (async () => {
  ({ profileDirectory: routing.profileDirectory = null } = await chrome.storage.local.get("profileDirectory"));
  for (const tab of await chrome.tabs.query({})) settledTabs.add(tab.id);
  connectRouting();
})();

chrome.tabs.onCreated.addListener((tab) => {
  const fresh = trackNewTab(tab.id);
  const url = tab.pendingUrl || tab.url;
  if (!fresh || !url || url === "about:blank") return;
  if (!RoutingRules.isWebUrl(url)) {
    settle(tab.id); // the new-tab page and other browser pages
    return;
  }
  fresh.source ??= "otherApps";
  void considerTab(tab.id, url);
});

chrome.webNavigation.onCreatedNavigationTarget.addListener(({ tabId, url }) => {
  const fresh = trackNewTab(tabId);
  if (!fresh) return;
  fresh.source = "webPages";
  void considerTab(tabId, url);
});

chrome.tabs.onUpdated.addListener((tabId, { url }) => {
  const fresh = url && freshTabs.get(tabId);
  if (!fresh) return;
  fresh.urlChanges += 1;
  if (fresh.urlChanges > MAX_FRESH_URL_CHANGES) {
    if (fresh.phase !== "routing") settle(tabId);
    return;
  }
  void considerTab(tabId, url);
});

// Once a fresh tab shows a page, later navigation is the user's own unless it follows at once, as a redirect does.
chrome.webNavigation.onCommitted.addListener(({ tabId, frameId }) => {
  const fresh = frameId === 0 && freshTabs.get(tabId);
  if (!fresh || fresh.committed) return;
  fresh.committed = true;
  setTimeout(() => {
    if (freshTabs.get(tabId) === fresh && fresh.phase !== "routing") settle(tabId);
  }, REDIRECT_WINDOW_MS);
});

// Request blocking can stop a tab that is then not routed, so it reloads once blocking skips it.
chrome.webNavigation.onErrorOccurred.addListener(({ tabId, frameId, error }) => {
  if (frameId !== 0 || !error.includes("ERR_BLOCKED_BY_CLIENT")) return;
  const fresh = freshTabs.get(tabId);
  if (fresh && fresh.phase !== "watching") {
    fresh.blocked = true;
    return;
  }
  settle(tabId);
  reloadAfterRuleUpdate(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  freshTabs.delete(tabId);
  settledTabs.delete(tabId);
  reloadedTabs.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handlers = {
    "get-link-routing": async () => ({ ...routing }),
    "save-link-routing": () => saveLinkRouting(message.settings),
    "identify-profiles": () => identifyProfiles(sender.tab),
    "profile-identified": () => rememberProfile(message.profileDirectory),
    "keep-tabs": () => keepTabs(message.tabIds ?? []).then(() => ({ ok: true }), () => ({ ok: false })),
  };
  const handler = handlers[message?.type];
  if (!handler) return false;
  void handler().then(sendResponse);
  return true;
});

function trackNewTab(tabId) {
  if (freshTabs.has(tabId)) return freshTabs.get(tabId);
  if (settledTabs.has(tabId)) return null;
  if (Date.now() < routerStartedAt + STARTUP_MS) {
    settle(tabId);
    return null;
  }
  const fresh = { source: null, urlChanges: 0, phase: "watching", blocked: false, committed: false };
  freshTabs.set(tabId, fresh);
  setTimeout(() => {
    if (freshTabs.get(tabId) === fresh && fresh.phase !== "routing") settle(tabId);
  }, FRESH_TAB_MS);
  return fresh;
}

async function considerTab(tabId, url) {
  await routerReady;
  const fresh = freshTabs.get(tabId);
  if (fresh?.phase !== "watching" || !RoutingRules.isWebUrl(url)) return;
  const { source } = fresh;
  if (!source) return; // Chrome may still name the source
  const destination = routeDestination(url, source);
  if (!destination) return; // a redirect may still match
  if (!routing.settings.routeFrom[source]) {
    settle(tabId);
    return;
  }

  fresh.phase = "deciding";
  const inNormalWindow = await isInNormalWindow(tabId);
  fresh.phase = "watching";
  if (freshTabs.get(tabId) !== fresh) return;
  if (fresh.source !== source) {
    void considerTab(tabId, url); // Chrome reported that a page opened the tab while its window was checked
    return;
  }
  if (!inNormalWindow || !routingPort) {
    settle(tabId); // popups, such as sign-in windows, stay where they are
    return;
  }
  fresh.phase = "routing";
  const requestId = nextRouteRequest++;
  routeRequests.set(requestId, { tabId, url });
  routingPort.postMessage({ type: "route", requestId, url, profileDirectory: destination });
}

// Links from other apps that match no rule go to the fallback profile, if one is set. Links that pages open stay, so
// browsing in a profile isn't pulled into another one.
function routeDestination(url, source) {
  const { settings } = routing;
  if (routing.status !== "connected" || !routing.profileDirectory || !settings) return null;
  if (!RoutingRules.isRoutable(url)) return null; // sign-in sites, which the fallback profile must not take either
  const rule = RoutingRules.winningRule(settings.rules, url);
  const destination = rule ? rule.profileDirectory : source === "otherApps" && settings.fallbackProfileDirectory;
  return destination && destination !== routing.profileDirectory ? destination : null;
}

async function isInNormalWindow(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return (await chrome.windows.get(tab.windowId)).type === "normal";
  } catch {
    return false;
  }
}

// The source tab closes only after the destination has opened the URL.
function finishRoute({ requestId, ok }) {
  const route = routeRequests.get(requestId);
  if (!route) return;
  routeRequests.delete(requestId);
  if (ok) {
    void closeRoutedTab(route);
    return;
  }
  settle(route.tabId);
}

// A blocked tab shows its routed URL until someone navigates it, so another URL means the user went elsewhere and
// the tab stays. A tab that loaded, as one sent to the fallback profile does, may have been redirected, so it closes.
async function closeRoutedTab({ tabId, url }) {
  const fresh = freshTabs.get(tabId);
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;
  if (fresh?.blocked && (tab.pendingUrl || tab.url) !== url) {
    fresh.blocked = false; // the blocked page is no longer showing, so the tab must not reload
    settle(tabId);
    return;
  }
  await chrome.tabs.remove(tabId).catch(() => {});
}

function settle(tabId) {
  const fresh = freshTabs.get(tabId);
  freshTabs.delete(tabId);
  settledTabs.add(tabId);
  updateBlockRules();
  if (fresh?.blocked) reloadAfterRuleUpdate(tabId);
}

// Request blocking skips the tab once the rule update finishes. The blocked request never reached the server, so the
// page still loads once. Another extension may also block the page, so a tab is reloaded at most once.
function reloadAfterRuleUpdate(tabId) {
  if (reloadedTabs.has(tabId)) return;
  reloadedTabs.add(tabId);
  void ruleUpdate.then(() => chrome.tabs.reload(tabId)).catch(() => {});
}

// Returns a promise that rejects if Chrome refuses the rules. Callers that ignore it still get the error logged.
function updateBlockRules() {
  const update = ruleUpdate.then(async () => {
    const { settings } = routing;
    const active = routing.status === "connected" && routing.profileDirectory && settings
      && (settings.routeFrom.otherApps || settings.routeFrom.webPages);
    const rules = active
      ? RoutingRules.sessionRules(settings.rules, routing.profileDirectory, [chrome.tabs.TAB_ID_NONE, ...settledTabs])
      : [];
    // Session rules outlive the service worker, so the rules to replace come from Chrome.
    const installed = await chrome.declarativeNetRequest.getSessionRules();
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: installed.map(({ id }) => id), addRules: rules });
    routing.ruleError = null;
  });
  ruleUpdate = update.catch((error) => {
    console.error("Could not update the link-routing rules:", error);
    routing.ruleError = "Chrome could not apply the link-routing rules. Check the rules, then try again.";
  });
  return update;
}

// Another profile routed these URLs here, or a manual move is arriving. Open them in this profile's last window.
// started tells ProfileBar whether any tab opened, because opening the URLs another way would then duplicate them.
async function openArrivals({ requestId, urls }) {
  let ok = false;
  let started = false;
  try {
    if (Array.isArray(urls) && urls.length > 0 && urls.every(RoutingRules.isWebUrl)) {
      const window = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
      for (const [index, url] of urls.entries()) {
        const tab = await chrome.tabs.create({ windowId: window.id, url: "about:blank", active: index === 0 });
        started = true;
        // An old rule could still block the page, so the arrival fails rather than load it.
        await keepTabs([tab.id]).catch(async (error) => {
          await chrome.tabs.remove(tab.id).catch(() => {});
          throw error;
        });
        await chrome.tabs.update(tab.id, { url });
      }
      ok = true;
      await chrome.windows.update(window.id, window.state === "minimized"
        ? { focused: true, state: "normal" }
        : { focused: true }).catch(() => {}); // the tabs are open even if Chrome declines to focus the window
    }
  } catch (error) {
    console.debug("Could not open the routed tabs in this profile:", error);
  }
  routingPort?.postMessage({ type: "opened", requestId, ok, started });
}

// ProfileBar opened these tabs here, so they stay even if a rule names another profile. Request blocking skips
// them once this resolves, so callers open them blank and load their URLs afterwards.
function keepTabs(tabIds) {
  for (const tabId of tabIds) {
    freshTabs.delete(tabId);
    settledTabs.add(tabId);
  }
  return updateBlockRules();
}

function connectRouting() {
  const port = chrome.runtime.connectNative(NATIVE_HOST);
  routingPort = port;
  port.onMessage.addListener((message) => {
    if (message?.type === "settings") {
      routing.status = "connected";
      routing.settings = message.settings ?? null;
      routing.settingsError = message.error ?? null;
      reconnectDelay = 1000;
      void updateBlockRules();
    } else if (message?.type === "routed") {
      finishRoute(message);
    } else if (message?.type === "open") {
      void openArrivals(message);
    } else if (message?.ok === false) {
      routing.status = "update-required"; // an older ProfileBar answered hello as a one-off request
    }
  });
  port.onDisconnect.addListener(() => {
    if (routingPort !== port) return;
    routingPort = null;
    if (routing.status !== "update-required") routing.status = "unavailable";
    failPendingRoutes();
    setTimeout(connectRouting, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 60_000);
  });
  port.postMessage({ type: "hello", profileDirectory: routing.profileDirectory });
}

function failPendingRoutes() {
  for (const requestId of [...routeRequests.keys()]) finishRoute({ requestId, ok: false });
  void updateBlockRules();
}

async function rememberProfile(profileDirectory) {
  if (typeof profileDirectory !== "string" || !profileDirectory) return { ok: false };
  await chrome.storage.local.set({ profileDirectory });
  routing.profileDirectory = profileDirectory;
  const port = routingPort;
  routingPort = null;
  port?.disconnect();
  routing.status = "connecting";
  failPendingRoutes();
  connectRouting();
  return { ok: true };
}

function routerStartupSettled() {
  const remaining = routerStartedAt + STARTUP_MS - Date.now();
  return remaining > 0 ? new Promise((resolve) => setTimeout(resolve, remaining)) : Promise.resolve();
}

async function saveLinkRouting(settings) {
  try {
    const response = await chrome.runtime.sendNativeMessage(NATIVE_HOST, { type: "saveLinkRouting", settings });
    if (response?.ok) return { ok: true };
    if (response?.error === "invalid_request" && routing.status !== "connected") return UPDATE_REQUIRED;
    return {
      ok: false, error: response?.error ?? "failed", ruleIndex: response?.ruleIndex,
      message: response?.message ?? "ProfileBar could not save the rules.",
    };
  } catch (error) {
    console.debug("ProfileBar could not save the link-routing rules:", error);
    return { ok: false, error: "unavailable", message: "Open ProfileBar, then try again." };
  }
}

// Adds an exact-host rule for the page, replacing any rule for the same host without a path.
function addSiteRule(url, profileDirectory) {
  if (!routing.settings) return Promise.resolve(UPDATE_REQUIRED);
  const host = new URL(url).hostname;
  const rules = routing.settings.rules.filter((rule) => !(rule.kind === "host" && rule.host === host && !rule.pathPrefix));
  rules.push({ id: crypto.randomUUID(), kind: "host", host, pathPrefix: "", profileDirectory });
  return saveLinkRouting({ ...routing.settings, rules });
}

// Each profile's identify page brings that profile's window forward, so the asking tab is brought back afterwards.
async function identifyProfiles(askingTab) {
  try {
    const response = await chrome.runtime.sendNativeMessage(NATIVE_HOST, { type: "identifyProfiles" });
    if (askingTab) {
      await chrome.windows.update(askingTab.windowId, { focused: true }).catch(() => {});
      await chrome.tabs.update(askingTab.id, { active: true }).catch(() => {});
    }
    if (response?.ok) return { ok: true, identified: response.identified, unreachable: response.unreachable };
    return { ok: false, error: response?.error === "invalid_request" ? "update-required" : "failed" };
  } catch (error) {
    console.debug("ProfileBar could not identify the profiles:", error);
    return { ok: false, error: "unavailable" };
  }
}
