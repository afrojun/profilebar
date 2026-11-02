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
const routingSection = document.querySelector("#routing");
const routingStatus = document.querySelector("#routing-status");
const routingIdentity = document.querySelector("#routing-identity");
const routingIdentityMessage = document.querySelector("#routing-identity-message");
const identifyButton = document.querySelector("#identify");
const identifyResult = document.querySelector("#identify-result");
const routingControls = document.querySelector("#routing-controls");
const routeOtherApps = document.querySelector("#route-other-apps");
const routeWebPages = document.querySelector("#route-web-pages");
const fallbackProfile = document.querySelector("#fallback-profile");
const ruleRows = document.querySelector("#rule-rows");
const noRules = document.querySelector("#no-rules");
const addRuleButton = document.querySelector("#add-rule");
const routingResult = document.querySelector("#routing-result");
const linkTest = document.querySelector("#link-test");
const linkTestResult = document.querySelector("#link-test-result");

// Each profile is { directory, title }, where the title names the folder when profiles share a name.
let routingProfiles = [];
let routingSettings = null;
let thisProfileDirectory = null;

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
identifyButton.addEventListener("click", () => void identifyProfiles());
addRuleButton.addEventListener("click", addRule);
routeOtherApps.addEventListener("change", () => {
  fallbackProfile.disabled = !routeOtherApps.checked;
  void saveRules();
});
routeWebPages.addEventListener("change", () => void saveRules());
fallbackProfile.addEventListener("change", () => void saveRules());
linkTest.addEventListener("input", showLinkTest);
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
  if (result?.state === "ready") await showRouting(result.profiles ?? []);
  else routingSection.hidden = true;
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
  const quoted = new Intl.ListFormat("en", { type: "conjunction" })
    .format([...new Set(profiles.map(({ name }) => `“${name}”`))]);
  sharedNamesMessage.textContent = `More than one Chrome profile is named ${quoted}, so the move menus `
    + "label them by folder and may also list the profile you are in. Rename one so you can tell them apart.";
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

async function showRouting(profiles) {
  routingProfiles = profiles;
  routingSection.hidden = false;
  let state = null;
  try {
    state = await chrome.runtime.sendMessage({ type: "get-link-routing" });
  } catch (error) {
    console.error("Could not check link routing:", error);
  }
  const connected = state?.status === "connected";
  thisProfileDirectory = state?.profileDirectory ?? null;
  routingStatus.textContent = routingStatusMessage(state);
  routingIdentity.hidden = !connected;
  const hasSettings = connected && Boolean(state.settings);
  routingControls.hidden = !hasSettings;
  if (!connected) return;
  routingIdentityMessage.textContent = state.profileDirectory
    ? `This is ${profileTitle(state.profileDirectory)}. After you add ProfileBar for Chrome to another profile, `
      + "choose Identify profiles again."
    : "This profile is not identified yet, so it does not route links. Choose Identify profiles once. "
      + "ProfileBar briefly opens a tab in each profile that has ProfileBar for Chrome.";
  if (hasSettings) renderSettings(state.settings);
}

function routingStatusMessage(state) {
  if (!state) return "Chrome could not check link routing. Try again in a moment.";
  const messages = {
    connecting: "Connecting to ProfileBar…",
    "update-required": "Update ProfileBar to version 1.5 or later to use link routing.",
    unavailable: "ProfileBar is not connected for link routing. Open ProfileBar, then reopen this page.",
  };
  return messages[state.status] ?? state.settingsError ?? state.ruleError ?? "";
}

function renderSettings(settings) {
  routingSettings = settings;
  routeOtherApps.checked = settings.routeFrom.otherApps;
  routeWebPages.checked = settings.routeFrom.webPages;
  const fallback = settings.fallbackProfileDirectory ?? "";
  fallbackProfile.replaceChildren(...profileOptions(fallback, ["", "The profile Chrome picks"])
    .map(([value, text]) => new Option(text, value, false, value === fallback)));
  fallbackProfile.disabled = !settings.routeFrom.otherApps;
  ruleRows.replaceChildren(...settings.rules.map(ruleRow));
  noRules.hidden = settings.rules.length > 0;
  showLinkTest();
}

function ruleRow(rule) {
  const row = document.createElement("tr");
  row.dataset.id = rule.id;

  const kind = selectControl("Match", [["host", "Site"], ["contains", "URL contains"]], rule.kind);
  const value = document.createElement("input");
  value.type = "text";
  value.spellcheck = false;
  value.setAttribute("aria-label", "Site or text");
  value.placeholder = "example.com or github.com/team";
  value.value = rule.kind === "host" ? RoutingRules.siteText(rule) : rule.text;
  const error = document.createElement("p");
  error.className = "rule-error";
  error.hidden = true;
  const profile = selectControl("Profile", profileOptions(rule.profileDirectory), rule.profileDirectory);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Remove";
  remove.setAttribute("aria-label", "Remove rule");

  for (const control of [kind, value, profile]) control.addEventListener("change", () => void saveRules());
  remove.addEventListener("click", () => {
    row.remove();
    noRules.hidden = ruleRows.children.length > 0;
    void saveRules();
  });

  const valueCell = document.createElement("td");
  valueCell.append(value, error);
  row.append(cell(kind), valueCell, cell(profile), cell(remove));
  return row;
}

// Lists the identified profiles, plus the selected one if it is no longer found.
function profileOptions(selected, ...extraOptions) {
  const options = [...extraOptions, ...routingProfiles.map(({ directory, title }) => [directory, title])];
  if (selected && !options.some(([value]) => value === selected)) options.push([selected, `${selected} (not found)`]);
  return options;
}

function selectControl(label, options, selected) {
  const select = document.createElement("select");
  select.setAttribute("aria-label", label);
  for (const [value, text] of options) select.append(new Option(text, value, false, value === selected));
  return select;
}

function cell(control) {
  const td = document.createElement("td");
  td.append(control);
  return td;
}

function addRule() {
  const row = ruleRow({
    id: crypto.randomUUID(), kind: "host", host: "", pathPrefix: "", profileDirectory: newRuleProfileDirectory(),
  });
  ruleRows.append(row);
  noRules.hidden = true;
  row.querySelector("input").focus();
}

// A new rule usually sends links away from this profile, so it starts with another profile.
function newRuleProfileDirectory() {
  const other = routingProfiles.find(({ directory }) => directory !== thisProfileDirectory);
  return (other ?? routingProfiles[0])?.directory ?? "Default";
}

// Reads the rows in order. Empty rows are skipped until they have a site or text.
function ruleEntries() {
  return [...ruleRows.querySelectorAll("tr")].map((row) => {
    const [kind, profile] = row.querySelectorAll("select");
    const text = row.querySelector("input").value.trim();
    if (!text) return null;
    const rule = kind.value === "host"
      ? { id: row.dataset.id, kind: "host", ...RoutingRules.parseSite(text), profileDirectory: profile.value }
      : { id: row.dataset.id, kind: "contains", text, profileDirectory: profile.value };
    return { row, rule };
  }).filter(Boolean);
}

async function saveRules() {
  const entries = ruleEntries();
  const settings = {
    ...routingSettings,
    routeFrom: { otherApps: routeOtherApps.checked, webPages: routeWebPages.checked },
    fallbackProfileDirectory: fallbackProfile.value || null,
    rules: entries.map(({ rule }) => rule),
  };
  for (const row of ruleRows.querySelectorAll("tr")) showRuleError(row, "");
  showRoutingResult("Saving…");
  let result = null;
  try {
    result = await chrome.runtime.sendMessage({ type: "save-link-routing", settings });
  } catch (error) {
    console.error("Could not save the link-routing rules:", error);
  }
  if (result?.ok) {
    routingSettings = settings;
    showLinkTest();
    showRoutingResult("Saved.");
    return;
  }
  const message = result?.message ?? "ProfileBar could not save the rules.";
  const failedRow = entries[result?.ruleIndex]?.row;
  if (failedRow) showRuleError(failedRow, message);
  showRoutingResult(failedRow ? "Not saved. Fix the highlighted rule." : message, true);
}

function showRuleError(row, message) {
  const input = row.querySelector("input");
  const error = row.querySelector(".rule-error");
  input.setAttribute("aria-invalid", String(Boolean(message)));
  error.textContent = message;
  error.hidden = !message;
}

function showRoutingResult(message, isError = false) {
  routingResult.textContent = message;
  routingResult.dataset.state = isError ? "error" : "";
}

async function identifyProfiles() {
  identifyButton.disabled = true;
  identifyResult.textContent = "Identifying profiles…";
  let result = null;
  try {
    result = await chrome.runtime.sendMessage({ type: "identify-profiles" });
  } catch (error) {
    console.error("Could not identify the profiles:", error);
  }
  identifyResult.textContent = identifyMessage(result);
  identifyButton.disabled = false;
  await showRouting(routingProfiles);
}

function identifyMessage(result) {
  if (result?.error === "update-required") return "Update ProfileBar to version 1.5 or later to identify profiles.";
  if (!result?.ok) return "ProfileBar could not identify the profiles. Try again.";
  const identified = result.identified.length === 0
    ? "No profiles have this extension turned on."
    : `Identified ${profileList(result.identified)}.`;
  if (result.unreachable.length === 0) return identified;
  return `${identified} ${profileList(result.unreachable)} did not answer. `
    + `Open ${result.unreachable.length === 1 ? "it" : "them"} in Chrome and try again.`;
}

// Explains where the saved rules send the link in the test box. It uses the router's own rule matching.
function showLinkTest() {
  linkTestResult.textContent = linkTestMessage(linkTest.value.trim());
}

function linkTestMessage(url) {
  if (!url) return "";
  if (!RoutingRules.isWebUrl(url)) return "Enter a link that starts with http:// or https://.";
  const { rules, routeFrom, fallbackProfileDirectory } = routingSettings;
  if (!routeFrom.otherApps && !routeFrom.webPages) return "Link routing is off.";
  let rule;
  try {
    if (RoutingRules.isSignInUrl(url)) return "Sign-in sites always stay where they open.";
    rule = RoutingRules.winningRule(rules, url);
  } catch {
    return "That link is not valid.";
  }
  if (rule) {
    const name = rule.kind === "host" ? `site rule ${RoutingRules.siteText(rule)}` : `“URL contains” rule ${rule.text}`;
    return `Opens in ${profileTitle(rule.profileDirectory)}, using the ${name}.`;
  }
  return fallbackProfileDirectory
    ? `No rule matches. From other apps it opens in ${profileTitle(fallbackProfileDirectory)}. `
      + "From web pages it stays where it opened."
    : "No rule matches, so it stays where Chrome opens it.";
}

function profileList(directories) {
  return new Intl.ListFormat("en", { type: "conjunction" }).format(directories.map(profileTitle));
}

function profileTitle(directory) {
  return routingProfiles.find((profile) => profile.directory === directory)?.title ?? directory;
}
