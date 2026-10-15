const status = document.querySelector("#status");
const heading = document.querySelector("#heading");
const intro = document.querySelector("#intro");
const steps = document.querySelector("#steps");
const checkButton = document.querySelector("#check");
const getProfileBar = document.querySelector("#get-profilebar");

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
  show(result?.state in views ? result.state : "error", result?.destinationCount);
  checkButton.disabled = false;
}

function show(state, destinationCount) {
  const view = views[state];
  status.dataset.state = state;
  status.textContent = state === "ready" ? connectedStatus(destinationCount) : view.status;
  heading.textContent = view.heading;
  intro.textContent = view.intro;
  steps.hidden = !view.steps;
  checkButton.hidden = state === "unsupported" || state === "ready";
  getProfileBar.hidden = !view.steps;
}

function connectedStatus(count) {
  if (count === 0) return "Connected · No other profiles found";
  return `Connected · ${count} other ${count === 1 ? "profile" : "profiles"}`;
}
