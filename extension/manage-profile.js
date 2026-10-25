// ProfileBar opens this page in a chosen profile from the setup page's rename buttons. Chrome
// opens its settings pages for extensions but not from the command line, so the page hands over.
async function openProfileSettings() {
  try {
    const tab = await chrome.tabs.getCurrent();
    await chrome.tabs.update(tab.id, { url: "chrome://settings/manageProfile" });
  } catch (error) {
    console.error("Could not open the profile settings:", error);
    document.querySelector("p").textContent =
      "Chrome could not open this profile’s settings. Enter chrome://settings/manageProfile in the address bar to rename it.";
  }
}

void openProfileSettings();
