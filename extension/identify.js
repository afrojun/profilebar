// ProfileBar opens this page in one profile with a relay token in its URL. Claiming the token tells this extension
// copy which profile it runs in. See "Profile identity" in docs/link-routing-design.md.
const NATIVE_HOST = chrome.runtime.getManifest().update_url
  ? "dev.afrojun.profilebar"
  : "dev.afrojun.profilebar.dev";

async function identifyProfile() {
  const token = location.hash.slice(1);
  history.replaceState(null, "", location.pathname);
  const tab = await chrome.tabs.getCurrent();
  try {
    if (/^[0-9a-f-]{36}$/.test(token)) {
      const response = await chrome.runtime.sendNativeMessage(NATIVE_HOST, { type: "claimIdentity", token });
      if (response?.ok && typeof response.profileDirectory === "string") {
        await chrome.runtime.sendMessage({ type: "profile-identified", profileDirectory: response.profileDirectory });
      }
    }
  } catch (error) {
    console.error("Could not identify this profile:", error);
  } finally {
    if (tab?.id) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

void identifyProfile();
