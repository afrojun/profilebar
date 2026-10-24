const status = document.querySelector("#status");
const heading = document.querySelector("#heading");
const intro = document.querySelector("#intro");
const steps = document.querySelector("#steps");
const checkButton = document.querySelector("#check");
const getProfileBar = document.querySelector("#get-profilebar");
const sharedNamesWarning = document.querySelector("#shared-names");
const sharedNamesMessage = document.querySelector("#shared-names-message");
const sharedNamesActions = document.querySelector("#shared-names-actions");
const sharedNamesResult = document.querySelector("#shared-names-result");

const renameResults = {
  opened: (folder) => `Chrome opened the settings for ${folder}. Change its name there.`,
  "extension-missing": (folder) => `ProfileBar for Chrome is not installed in ${folder}. `
    + "Open chrome://settings/manageProfile in that profile to rename it.",
  "update-required": () => "Update ProfileBar to rename profiles from here, "
    + "or open chrome://settings/manageProfile in the profile you want to rename.",
  failed: () => "Chrome could not open the settings. "
    + "Open chrome://settings/manageProfile in the profile you want to rename.",
};

const views = {
  preview: {
    status: "Preview",
    heading: "Connect ProfileBar",
    intro: "Open this page from the installed extension to check the connection.",
    steps: true,
  },
  unsupported: {
    status: "macOS only",
    heading: "ProfileBar requires macOS",
    intro: "This extension moves tabs with the ProfileBar app, which is available for macOS.",
    steps: false,
  },
  setup: {
    status: "ProfileBar not found",
    heading: "Connect ProfileBar",
    intro: "This extension asks the ProfileBar app on your Mac to open pages in another Chrome profile.",
    steps: true,
  },
  ready: {
    heading: "Ready to move tabs",
    intro: "Right-click a page, or a tab in Chrome 150 and later, and choose Move tab to profile. Select several tabs first to move them together, or right-click a tab in a group to move the whole group.",
    steps: false,
  },
  error: {
    status: "Check failed",
    heading: "Connect ProfileBar",
    intro: "Chrome could not check the connection. Try again in a moment.",
    steps: true,
  },
};

checkButton.addEventListener("click", () => void checkProfileBar());
window.addEventListener("focus", () => void checkProfileBar());
void checkProfileBar();

async function checkProfileBar() {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    show("preview");
    checkButton.disabled = true;
    return;
  }

  checkButton.disabled = true;
  status.dataset.state = "checking";
  status.textContent = "Checking ProfileBar…";
  let result;
  try {
    result = await chrome.runtime.sendMessage({ type: "check-profilebar" });
  } catch (error) {
    console.error("Could not check ProfileBar:", error);
  }
  show(result?.state in views ? result.state : "error", result?.destinationCount, result?.sharedNameProfiles);
  checkButton.disabled = false;
}

function show(state, destinationCount, sharedNameProfiles = []) {
  const view = views[state];
  status.dataset.state = state;
  status.textContent = state === "ready" ? connectedStatus(destinationCount) : view.status;
  heading.textContent = view.heading;
  intro.textContent = view.intro;
  steps.hidden = !view.steps;
  checkButton.hidden = state === "unsupported" || state === "ready";
  getProfileBar.hidden = !view.steps;
  showSharedNames(state === "ready" ? sharedNameProfiles : []);
}

function showSharedNames(profiles) {
  sharedNamesWarning.hidden = profiles.length === 0;
  const quoted = [...new Set(profiles.map(({ name }) => `“${name}”`))].join(" and ");
  sharedNamesMessage.textContent = `More than one Chrome profile is named ${quoted}, so the move menus `
    + "label them by folder and also list the profile you are in. Rename one so you can tell them apart.";
  sharedNamesActions.replaceChildren(...profiles.map(renameButton));
  sharedNamesResult.textContent = "";
}

function renameButton({ directory, name }) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = `Rename ${name} (${directory})`;
  button.addEventListener("click", async () => {
    button.disabled = true;
    let response;
    try {
      response = await chrome.runtime.sendMessage({ type: "open-profile-settings", profileDirectory: directory });
    } catch (error) {
      console.error("Could not open the profile settings:", error);
    }
    sharedNamesResult.textContent = (renameResults[response?.result] ?? renameResults.failed)(directory);
    button.disabled = false;
  });
  return button;
}

function connectedStatus(count) {
  if (count === 0) return "Connected · No other profiles found";
  return `Connected · ${count} other ${count === 1 ? "profile" : "profiles"}`;
}
