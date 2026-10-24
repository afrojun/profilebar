// ProfileBar opens this page in a chosen profile from the setup page's rename buttons. Chrome
// opens its settings pages for extensions but not from the command line, so the page hands over.
async function openProfileSettings() {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id) await chrome.tabs.update(tab.id, { url: "chrome://settings/manageProfile" });
}

void openProfileSettings();
