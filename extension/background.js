// The Chrome Web Store adds update_url to installed packages; unpacked builds talk to ProfileBar Dev.
const NATIVE_HOST = chrome.runtime.getManifest().update_url
  ? "dev.afrojun.profilebar"
  : "dev.afrojun.profilebar.dev";
const PAGE_MENU_ROOT = "move-to-profile";
const TAB_MENU_ROOT = "tab-actions";
const MENU_SETUP = "setup-profilebar";
const MENU_REFRESH = "refresh-profiles";
const PROFILE_PREFIX = "profile:";

let menuRefresh = Promise.resolve();

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    void chrome.runtime.openOptionsPage();
  }
  void refreshProfileMenu();
});
chrome.runtime.onStartup.addListener(() => {
  void refreshProfileMenu();
});
chrome.windows.onFocusChanged.addListener(() => {
  void refreshProfileMenu();
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "check-profilebar") return false;
  void refreshProfileMenu().then(sendResponse);
  return true;
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const itemId = String(info.menuItemId);
  const menuId = itemId.replace(/^(tab:|group:)/, "");
  if (menuId === MENU_SETUP) {
    void chrome.runtime.openOptionsPage();
    return;
  }
  if (menuId === MENU_REFRESH) {
    void refreshProfileMenu();
    return;
  }
  if (menuId.startsWith(PROFILE_PREFIX)) {
    const mode = itemId.startsWith("group:") ? "group" : itemId.startsWith("tab:") ? "tab" : "page";
    void moveToProfile(menuId, info, tab, mode);
  }
});

function refreshProfileMenu() {
  menuRefresh = menuRefresh.catch(() => {}).then(buildProfileMenu).catch((error) => {
    console.error("Could not update the profile menu:", error);
  });
  return menuRefresh;
}

async function buildProfileMenu() {
  let profiles;
  const platform = await chrome.runtime.getPlatformInfo();
  // ProfileBar's native helper is macOS-only. Drop this check when it runs elsewhere.
  let state = platform.os === "mac" ? "setup" : "unsupported";
  if (state === "setup") {
    try {
      const response = await chrome.runtime.sendNativeMessage(NATIVE_HOST, { type: "listProfiles" });
      if (!response?.ok || !Array.isArray(response.profiles) || !response.profiles.every(
        (profile) => profile && typeof profile.directory === "string" && typeof profile.name === "string",
      )) throw new Error("Invalid profile list");
      profiles = response.profiles;
      if (profiles.some(({ directory }) => directory === response.focusedProfileDirectory)) {
        const window = await chrome.windows.getLastFocused().catch(() => null);
        if (window?.focused) {
          profiles = profiles.filter(({ directory }) => directory !== response.focusedProfileDirectory);
        }
      }
      state = "ready";
    } catch (error) {
      console.debug("ProfileBar is unavailable:", error);
    }
  }

  await removeMenus();
  await buildPageMenu(state, profiles);
  if (chrome.contextMenus.ContextType?.TAB) {
    await buildTabMenu(state, profiles);
  }
  return { state, destinationCount: profiles?.length ?? 0 };
}

async function buildPageMenu(state, profiles) {
  const contexts = ["page"];
  const parentId = PAGE_MENU_ROOT;
  await createMenu({ id: parentId, title: "Move tab to profile", contexts });
  if (state === "unsupported") {
    await createMenu({ id: "mac-only", parentId, title: "ProfileBar requires macOS", enabled: false, contexts });
    return;
  }
  if (state === "setup") {
    await createMenu({ id: MENU_SETUP, parentId, title: "Set up ProfileBar…", contexts });
  } else if (profiles.length === 0) {
    await createMenu({ id: "no-profiles", parentId, title: "No destination profiles found", enabled: false, contexts });
  } else {
    for (const profile of namedProfiles(profiles)) {
      await createMenu({
        id: `${PROFILE_PREFIX}${encodeURIComponent(profile.directory)}`,
        parentId,
        title: profile.title,
        contexts,
      });
    }
  }
  await createMenu({ id: "profiles-refresh-divider", parentId, type: "separator", contexts });
  await createMenu({ id: MENU_REFRESH, parentId, title: "Refresh profiles", contexts });
}

async function buildTabMenu(state, profiles) {
  const contexts = ["tab"];
  const parentId = TAB_MENU_ROOT;
  await createMenu({ id: parentId, title: "Move tabs to profile", contexts });

  if (state === "ready" && profiles.length > 0) {
    const destinations = namedProfiles(profiles);
    for (const profile of destinations) {
      await createMenu({
        id: `tab:${PROFILE_PREFIX}${encodeURIComponent(profile.directory)}`,
        parentId,
        title: `Move tab to ${profile.title}`,
        contexts,
      });
    }
    await createTabDivider("tab:group-divider");
    for (const profile of destinations) {
      await createMenu({
        id: `group:${PROFILE_PREFIX}${encodeURIComponent(profile.directory)}`,
        parentId,
        title: `Move group to ${profile.title}`,
        contexts,
      });
    }
  } else {
    let option;
    if (state === "unsupported") {
      option = { id: "tab:mac-only", title: "ProfileBar requires macOS", enabled: false };
    } else if (state === "setup") {
      option = { id: `tab:${MENU_SETUP}`, title: "Set up ProfileBar…" };
    } else {
      option = { id: "tab:no-profiles", title: "No destination profiles found", enabled: false };
    }
    await createMenu({ ...option, parentId, contexts });
  }

  if (state !== "unsupported") {
    await createTabDivider("tab:profiles-refresh-divider");
    await createMenu({ id: `tab:${MENU_REFRESH}`, parentId, title: "Refresh profiles", contexts });
  }
}

function createTabDivider(id) {
  // Chrome hides native separators in tab submenus; this short rule matches the page menu.
  return createMenu({ id, parentId: TAB_MENU_ROOT, title: "───────", enabled: false, contexts: ["tab"] });
}

function namedProfiles(profiles) {
  const nameCounts = new Map();
  for (const profile of profiles) nameCounts.set(profile.name, (nameCounts.get(profile.name) ?? 0) + 1);
  return profiles.map((profile) => ({
    directory: profile.directory,
    title: nameCounts.get(profile.name) > 1 ? `${profile.name} (${profile.directory})` : profile.name,
  }));
}

function removeMenus() {
  return new Promise((resolve, reject) => {
    chrome.contextMenus.removeAll(() => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function createMenu(properties) {
  return new Promise((resolve, reject) => {
    chrome.contextMenus.create(properties, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

async function moveToProfile(menuId, info, tab, mode) {
  if (!Number.isInteger(tab?.id)) {
    await showMoveError("source-unavailable");
    return;
  }

  let source;
  try {
    source = mode === "group"
      ? await selectedGroup(tab)
      : { tabs: mode === "tab" ? await selectedTabs(tab) : [{ id: tab.id, url: info.pageUrl ?? tab.url }] };
  } catch (error) {
    let code = "selection-changed";
    if (mode === "group") {
      code = tab.groupId == null || tab.groupId === -1 ? "not-in-group" : "group-changed";
    }
    await showMoveError(code);
    return;
  }
  const sourceTabs = source.tabs;
  if (sourceTabs.some(({ url, pendingUrl }) => !url || !/^https?:\/\//i.test(url) || pendingUrl)) {
    await showMoveError("unsupported-url");
    return;
  }
  const encoder = new TextEncoder();
  const urlSizes = sourceTabs.map(({ url }) => encoder.encode(url).length);
  if (sourceTabs.length > 100 || urlSizes.some((size) => size > 65_536)
      || urlSizes.reduce((total, size) => total + size, 0) > 120_000) {
    await showMoveError("batch-too-large");
    return;
  }

  let response;
  try {
    const profileDirectory = decodeURIComponent(menuId.slice(PROFILE_PREFIX.length));
    const urls = sourceTabs.map(({ url }) => url);
    const request = source.group
      ? { type: "openGroup", profileDirectory, urls, group: {
        title: source.group.title ?? "", color: source.group.color, collapsed: source.group.collapsed,
      } }
      : urls.length === 1
        ? { type: "openURL", profileDirectory, url: urls[0] }
        : { type: "openURLs", profileDirectory, urls };
    response = await chrome.runtime.sendNativeMessage(NATIVE_HOST, request);
  } catch (error) {
    console.debug("ProfileBar could not open the tab:", error);
    void refreshProfileMenu();
    await showMoveError("profilebar-unavailable");
    return;
  }

  if (response?.ok) {
    const closed = await closeSourceTabs(sourceTabs, source.group);
    if (closed && source.group && response.grouped === false) {
      await showMoveError("group-opened-ungrouped");
    }
  } else if (response?.error === "profile_not_found") {
    void refreshProfileMenu();
    await showMoveError("profile-changed");
  } else if ((sourceTabs.length > 1 || source.group) && response?.error === "invalid_request") {
    await showMoveError("profilebar-update-required");
  } else {
    await showMoveError("open-failed");
  }
}

async function selectedTabs(clickedTab) {
  if (!Number.isInteger(clickedTab.windowId)) return [{ id: clickedTab.id, url: clickedTab.url }];
  const highlighted = await chrome.tabs.query({ highlighted: true, windowId: clickedTab.windowId });
  if (highlighted.length < 2 || !highlighted.some(({ id }) => id === clickedTab.id)) {
    return [{ id: clickedTab.id, url: clickedTab.url }];
  }
  return highlighted.sort((a, b) => a.index - b.index);
}

async function selectedGroup(clickedTab) {
  if (!Number.isInteger(clickedTab?.groupId) || clickedTab.groupId === -1
      || !Number.isInteger(clickedTab.windowId)) {
    throw new Error("The clicked tab is not in a group.");
  }
  const [group, tabs] = await Promise.all([
    chrome.tabGroups.get(clickedTab.groupId),
    chrome.tabs.query({ groupId: clickedTab.groupId, windowId: clickedTab.windowId }),
  ]);
  if (tabs.length === 0 || !tabs.some(({ id }) => id === clickedTab.id)) {
    throw new Error("The clicked tab left its group.");
  }
  return { group, tabs: tabs.sort((a, b) => a.index - b.index) };
}

async function closeSourceTabs(sourceTabs, group) {
  try {
    if (group) {
      let currentGroup;
      try {
        currentGroup = await selectedGroup(sourceTabs[0]);
      } catch (error) {
        await showMoveError("source-changed");
        return false;
      }
      if (currentGroup.tabs.length !== sourceTabs.length
          || currentGroup.tabs.some((tab, index) => tab.id !== sourceTabs[index].id)
          || currentGroup.group.title !== group.title
          || currentGroup.group.color !== group.color
          || currentGroup.group.collapsed !== group.collapsed) {
        await showMoveError("source-changed");
        return false;
      }
    }
    const current = await Promise.all(sourceTabs.map(({ id }) => chrome.tabs.get(id)));
    if (current.some((tab, index) => tab.url !== sourceTabs[index].url || tab.pendingUrl)) {
      await showMoveError("source-changed");
      return false;
    }
    await chrome.tabs.remove(sourceTabs.map(({ id }) => id));
    return true;
  } catch (error) {
    console.error("Could not close the original tab:", error);
    await showMoveError("close-failed");
    return false;
  }
}

function showMoveError(code) {
  return chrome.tabs.create({ url: chrome.runtime.getURL(`move-status.html#${code}`) });
}
