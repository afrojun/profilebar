// The Chrome Web Store adds update_url to installed packages; unpacked builds talk to ProfileBar Dev.
const NATIVE_HOST = chrome.runtime.getManifest().update_url
  ? "dev.afrojun.profilebar"
  : "dev.afrojun.profilebar.dev";

async function receiveGroup() {
  const token = location.hash.slice(1);
  history.replaceState(null, "", location.pathname);
  const receiverTab = await chrome.tabs.getCurrent();
  if (!receiverTab?.id) return;
  if (!/^[0-9a-f-]{36}$/.test(token)) {
    await chrome.tabs.remove(receiverTab.id);
    return;
  }

  const createdTabs = [];
  let claimed = false;
  let groupReady = false;
  let completionAttempted = false;
  try {
    const response = await chrome.runtime.sendNativeMessage(NATIVE_HOST, { type: "claimGroup", token });
    if (!response?.ok || !Array.isArray(response.urls) || !response.group) return;
    claimed = true;
    // These tabs belong here even if a link-routing rule names another profile, so each opens blank until link
    // routing keeps it. If Chrome refused the rules, an old rule could block the page, so the move fails instead.
    for (const url of response.urls) {
      const tab = await chrome.tabs.create({
        url: "about:blank",
        windowId: receiverTab.windowId,
        index: receiverTab.index + 1 + createdTabs.length,
        active: false,
      });
      createdTabs.push(tab.id);
      const kept = await chrome.runtime.sendMessage({ type: "keep-tabs", tabIds: [tab.id] }).catch(() => null);
      if (!kept?.ok) throw new Error("Link routing could not keep the tab in this profile.");
      await chrome.tabs.update(tab.id, { url });
    }
    const groupId = await chrome.tabs.group({
      tabIds: createdTabs,
      createProperties: { windowId: receiverTab.windowId },
    });
    await chrome.tabGroups.update(groupId, response.group);
    await TabSplits.rebuild(createdTabs, response.splits);
    groupReady = true;
    completionAttempted = true;
    const completion = await chrome.runtime.sendNativeMessage(NATIVE_HOST, { type: "completeGroup", token, ok: true });
    if (!completion?.ok) throw new Error("ProfileBar did not confirm the completed group.");
  } catch (error) {
    console.error("Could not recreate the tab group:", error);
    if (!groupReady && createdTabs.length > 0) {
      try { await chrome.tabs.remove(createdTabs); } catch (cleanupError) {
        console.error("Could not remove incomplete destination tabs:", cleanupError);
      }
    }
    if (claimed && !completionAttempted) {
      try { await chrome.runtime.sendNativeMessage(NATIVE_HOST, { type: "completeGroup", token, ok: false }); }
      catch (reportError) { console.error("Could not report the group failure:", reportError); }
    }
  } finally {
    try { await chrome.tabs.remove(receiverTab.id); } catch (error) {
      console.debug("Could not close the group receiver tab:", error);
    }
  }
}

void receiveGroup();
