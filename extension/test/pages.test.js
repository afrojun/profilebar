const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

// Runs a page's scripts in the order its HTML loads them.
function runPage(page, context) {
  const html = fs.readFileSync(path.join(root, page), "utf8");
  vm.createContext(context);
  for (const [, file] of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context);
  }
}

test("manifest requires ProfileBar access, routing permissions, and no page access", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "ProfileBar for Chrome");
  assert.ok(manifest.description.length <= 132);
  assert.deepEqual(manifest.permissions, [
    "contextMenus", "declarativeNetRequest", "nativeMessaging", "storage", "tabGroups", "tabs", "webNavigation",
  ]);
  assert.equal(manifest.optional_permissions, undefined);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.commands, undefined);
  assert.deepEqual(manifest.options_ui, { page: "setup.html", open_in_tab: true });
});

test("the destination receiver recreates a group before acknowledging the move", async () => {
  const calls = [];
  const token = "a74ac3fb-1e22-49cc-84ce-efb579d7ade1";
  const chrome = {
    runtime: {
      getManifest() { return { update_url: "https://clients2.google.com/service/update2/crx" }; },
      async sendMessage(message) { calls.push(["message", message]); return { ok: true }; },
      async sendNativeMessage(host, message) {
        calls.push(["native", host, message]);
        return message.type === "claimGroup"
          ? { ok: true, urls: ["https://example.com/first", "https://example.com/second"],
            group: { title: "Research", color: "blue", collapsed: true } }
          : { ok: true };
      },
    },
    tabs: {
      async getCurrent() { return { id: 7, windowId: 4, index: 2 }; },
      async create(options) {
        calls.push(["create", options]);
        return { id: calls.filter(([type]) => type === "create").length + 10 };
      },
      async update(id, { url }) { calls.push(["load", id, url]); },
      async group(options) { calls.push(["group", options]); return 22; },
      async remove(ids) { calls.push(["remove", ids]); },
    },
    tabGroups: {
      async update(id, details) { calls.push(["update", id, details]); },
    },
  };

  runPage("group-receiver.html", {
    chrome,
    location: { hash: `#${token}`, pathname: "/group-receiver.html" },
    history: { replaceState() {} },
    console,
  });
  await new Promise(setImmediate);

  // Each tab opens blank and loads its URL only after link routing keeps it, so routing never blocks it.
  assert.deepEqual(JSON.parse(JSON.stringify(calls.slice(1, 7).map(([type, details, url]) =>
    type === "create" ? [type, details.url] : type === "message" ? [details.type, details.tabIds] : [type, details, url]))), [
    ["create", "about:blank"], ["keep-tabs", [11]], ["load", 11, "https://example.com/first"],
    ["create", "about:blank"], ["keep-tabs", [12]], ["load", 12, "https://example.com/second"],
  ]);
  assert.deepEqual(Array.from(calls.find(([type]) => type === "group")[1].tabIds), [11, 12]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.find(([type]) => type === "update")[2])), {
    title: "Research", color: "blue", collapsed: true,
  });
  assert.equal(calls.findIndex(([type, , message]) => type === "native" && message.type === "completeGroup")
    > calls.findIndex(([type]) => type === "update"), true);
  assert.deepEqual(calls.at(-1), ["remove", 7]);
});

test("the destination receiver splits tabs that were split before the move", async () => {
  const calls = [];
  let nextTabId = 11;
  const chrome = {
    runtime: {
      getManifest() { return { update_url: "https://clients2.google.com/service/update2/crx" }; },
      async sendMessage() { return { ok: true }; },
      async sendNativeMessage(host, message) {
        calls.push(["native", message]);
        return message.type === "claimGroup"
          ? { ok: true, urls: ["https://example.com/a", "https://example.com/b", "https://example.com/c"],
            group: { title: "Research", color: "blue", collapsed: false }, splits: [[1, 2]] }
          : { ok: true };
      },
    },
    tabs: {
      async getCurrent() { return { id: 7, windowId: 4, index: 2 }; },
      async create() { return { id: nextTabId++ }; },
      async update() {},
      async group() { calls.push(["group"]); return 22; },
      async createSplit(ids) { calls.push(["split", ids]); },
      async remove(ids) { calls.push(["remove", ids]); },
    },
    tabGroups: { async update() { calls.push(["update"]); } },
  };

  runPage("group-receiver.html", {
    chrome,
    location: { hash: "#a74ac3fb-1e22-49cc-84ce-efb579d7ade1", pathname: "/group-receiver.html" },
    history: { replaceState() {} },
    console,
  });
  await new Promise(setImmediate);

  const steps = calls.map(([type, details]) => (type === "native" ? details.type : type));
  assert.deepEqual(plain(calls.find(([type]) => type === "split")[1]), [12, 13]);
  assert.ok(steps.indexOf("split") > steps.indexOf("group"), "Chrome splits tabs only within one group");
  assert.deepEqual(plain(calls.find(([type, details]) => type === "native" && details.type === "completeGroup")[1]),
    { type: "completeGroup", token: "a74ac3fb-1e22-49cc-84ce-efb579d7ade1", ok: true });
});

test("a failed destination group removes created tabs and reports failure", async () => {
  const calls = [];
  const chrome = {
    runtime: {
      getManifest() { return { update_url: "https://clients2.google.com/service/update2/crx" }; },
      async sendMessage() { return { ok: true }; },
      async sendNativeMessage(host, message) {
        calls.push(["native", message]);
        return message.type === "claimGroup"
          ? { ok: true, urls: ["https://example.com/first", "https://example.com/second"],
            group: { title: "Research", color: "blue", collapsed: false } }
          : { ok: true };
      },
    },
    tabs: {
      async getCurrent() { return { id: 7, windowId: 4, index: 2 }; },
      async create(options) {
        calls.push(["create", options]);
        if (calls.filter(([type]) => type === "create").length === 2) throw new Error("Chrome could not create the tab");
        return { id: 11 };
      },
      async update() {},
      async remove(ids) { calls.push(["remove", ids]); },
    },
  };

  runPage("group-receiver.html", {
    chrome,
    location: { hash: "#a74ac3fb-1e22-49cc-84ce-efb579d7ade1", pathname: "/group-receiver.html" },
    history: { replaceState() {} },
    console: { error() {}, debug() {} },
  });
  await new Promise(setImmediate);

  assert.deepEqual(Array.from(calls.find(([type, ids]) => type === "remove" && Array.isArray(ids))[1]), [11]);
  assert.equal(calls.find(([type, message]) => type === "native" && message.type === "completeGroup")[1].ok, false);
  assert.deepEqual(calls.at(-1), ["remove", 7]);
});

test("a group move fails without loading its pages when link routing cannot keep the tabs", async () => {
  const calls = [];
  const chrome = {
    runtime: {
      getManifest() { return { update_url: "https://clients2.google.com/service/update2/crx" }; },
      async sendMessage() { return { ok: false }; },
      async sendNativeMessage(host, message) {
        calls.push(["native", message]);
        return message.type === "claimGroup"
          ? { ok: true, urls: ["https://example.com/first"], group: { title: "Research", color: "blue", collapsed: false } }
          : { ok: true };
      },
    },
    tabs: {
      async getCurrent() { return { id: 7, windowId: 4, index: 2 }; },
      async create() { return { id: 11 }; },
      async update(id, { url }) { calls.push(["load", id, url]); },
      async remove(ids) { calls.push(["remove", ids]); },
    },
  };

  runPage("group-receiver.html", {
    chrome,
    location: { hash: "#a74ac3fb-1e22-49cc-84ce-efb579d7ade1", pathname: "/group-receiver.html" },
    history: { replaceState() {} },
    console: { error() {}, debug() {} },
  });
  await new Promise(setImmediate);

  assert.equal(calls.some(([type]) => type === "load"), false);
  assert.deepEqual(Array.from(calls.find(([type, ids]) => type === "remove" && Array.isArray(ids))[1]), [11]);
  assert.equal(calls.find(([type, message]) => type === "native" && message.type === "completeGroup")[1].ok, false,
    "the source group stays open");
});

// A small stand-in for the DOM operations that setup.js uses.
function fakeElement(tagName = "div") {
  const element = {
    tagName: tagName.toUpperCase(),
    dataset: {},
    attributes: {},
    listeners: {},
    hidden: false,
    disabled: false,
    checked: false,
    textContent: "",
    className: "",
    children: [],
    parent: null,
    addEventListener(type, listener) {
      element.listener = listener;
      element.listeners[type] = listener;
    },
    append(...children) {
      for (const child of children) {
        child.parent = element;
        element.children.push(child);
      }
    },
    replaceChildren(...children) {
      element.children = [];
      element.append(...children);
    },
    remove() { element.parent?.children.splice(element.parent.children.indexOf(element), 1); },
    setAttribute(name, value) { element.attributes[name] = String(value); },
    getAttribute(name) { return element.attributes[name] ?? null; },
    focus() {},
    querySelectorAll(selector) {
      const matches = (node) => (selector.startsWith(".")
        ? node.className === selector.slice(1)
        : node.tagName === selector.toUpperCase());
      const found = [];
      const visit = (node) => node.children?.forEach((child) => {
        if (matches(child)) found.push(child);
        visit(child);
      });
      visit(element);
      return found;
    },
    querySelector(selector) { return element.querySelectorAll(selector)[0] ?? null; },
  };
  if (element.tagName === "SELECT") {
    Object.defineProperty(element, "value", {
      get() { return (element.children.find((option) => option.selected) ?? element.children[0])?.value; },
      set(value) { for (const option of element.children) option.selected = option.value === value; },
    });
  } else {
    element.value = "";
  }
  return element;
}

const setupSelectors = {
  "#status": "p", "#heading": "h1", "#intro": "p", "#steps": "ol", "#check": "button", "#get-profilebar": "a",
  "#shared-names": "div", "#shared-names-message": "p", "#shared-names-actions": "div", "#shared-names-result": "p",
  "#routing": "section", "#routing-status": "p", "#routing-identity": "div", "#routing-identity-message": "p",
  "#identify": "button", "#identify-result": "p", "#routing-controls": "div", "#route-other-apps": "input",
  "#route-web-pages": "input", "#fallback-profile": "select", "#rule-rows": "tbody", "#no-rules": "p", "#add-rule": "button",
  "#routing-result": "p", "#link-test": "input", "#link-test-result": "p",
};

function setupHarness(chrome) {
  const elements = {};
  for (const [selector, tagName] of Object.entries(setupSelectors)) elements[selector] = fakeElement(tagName);
  const listeners = {};
  let nextUUID = 1;
  const context = vm.createContext({
    chrome,
    URL,
    console: { error() {} },
    crypto: { randomUUID: () => `new-${nextUUID++}` },
    document: { querySelector: (selector) => elements[selector], createElement: fakeElement },
    Intl,
    Option: function Option(text, value, defaultSelected, selected) {
      return { tagName: "OPTION", text, value, selected };
    },
    window: { addEventListener(type, listener) { listeners[type] = listener; } },
  });
  for (const file of ["routing-rules.js", "setup.js"]) {
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context);
  }
  return { elements, listeners };
}

test("the setup page shows connected profiles without setup steps", async () => {
  const { elements } = setupHarness({
    runtime: { async sendMessage(message) {
      assert.ok(["check-profilebar", "get-link-routing"].includes(message.type));
      return message.type === "check-profilebar" ? { state: "ready", destinationCount: 1 } : { status: "connected" };
    } },
  });
  await new Promise(setImmediate);

  assert.equal(elements["#status"].dataset.state, "ready");
  assert.equal(elements["#status"].textContent, "Connected · 1 other profile");
  assert.equal(elements["#heading"].textContent, "Ready to move tabs");
  assert.equal(elements["#steps"].hidden, true);
  assert.equal(elements["#check"].hidden, true);
  assert.equal(elements["#get-profilebar"].hidden, true);
  assert.equal(elements["#shared-names"].hidden, true);
});

test("the setup page offers to rename each profile that shares a name", async () => {
  const messages = [];
  const { elements } = setupHarness({
    runtime: { async sendMessage(message) {
      messages.push(message);
      if (message.type === "open-profile-settings") return { result: "extension-missing" };
      return { state: "ready", destinationCount: 4, sharedNameProfiles: [
        { directory: "Profile 3", name: "Taylor" },
        { directory: "Profile 5", name: "Taylor" },
        { directory: "Profile 6", name: "Work" },
        { directory: "Profile 7", name: "Work" },
      ] };
    } },
  });
  await new Promise(setImmediate);

  assert.equal(elements["#shared-names"].hidden, false);
  assert.match(elements["#shared-names-message"].textContent, /named “Taylor” and “Work”, so/);
  const buttons = elements["#shared-names-actions"].children;
  assert.deepEqual(buttons.map((button) => button.textContent), [
    "Rename Taylor (Profile 3)", "Rename Taylor (Profile 5)", "Rename Work (Profile 6)", "Rename Work (Profile 7)",
  ]);

  await buttons[1].listener();
  assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))), { type: "open-profile-settings", profileDirectory: "Profile 5" });
  assert.match(elements["#shared-names-result"].textContent, /not installed in Profile 5/);
  assert.equal(buttons[1].disabled, false);
});

test("the setup page guides installation and checks again on request", async () => {
  const states = ["setup", "ready"];
  const { elements } = setupHarness({
    runtime: { async sendMessage() { return { state: states.shift(), destinationCount: 0 }; } },
  });
  await new Promise(setImmediate);

  assert.equal(elements["#status"].textContent, "ProfileBar not found");
  assert.equal(elements["#steps"].hidden, false);
  assert.equal(elements["#check"].disabled, false);
  assert.equal(elements["#get-profilebar"].hidden, false);

  elements["#check"].listener();
  await new Promise(setImmediate);
  assert.equal(elements["#status"].textContent, "Connected · No other profiles found");
});

test("the setup page explains macOS-only support and failed checks", async () => {
  const unsupported = setupHarness({ runtime: { async sendMessage() { return { state: "unsupported" }; } } });
  await new Promise(setImmediate);
  assert.equal(unsupported.elements["#heading"].textContent, "ProfileBar requires macOS");
  assert.equal(unsupported.elements["#check"].hidden, true);
  assert.equal(unsupported.elements["#steps"].hidden, true);

  const failed = setupHarness({ runtime: { async sendMessage() { throw new Error("No receiver"); } } });
  await new Promise(setImmediate);
  assert.equal(failed.elements["#status"].dataset.state, "error");
  assert.equal(failed.elements["#check"].hidden, false);
});

test("the move status page explains the error code", () => {
  const elements = { "#heading": { textContent: "" }, "#detail": { textContent: "" } };
  const document = { querySelector: (selector) => elements[selector] };
  runPage("move-status.html", { document, location: { hash: "#group-opened-ungrouped" } });
  assert.equal(elements["#heading"].textContent, "Tabs moved without a group");
  assert.match(elements["#detail"].textContent, /Install ProfileBar for Chrome in that profile/);

  runPage("move-status.html", { document, location: { hash: "#unknown" } });
  assert.match(elements["#detail"].textContent, /could not open the selected pages/);
});

const flush = () => new Promise(setImmediate);
const plain = (value) => JSON.parse(JSON.stringify(value));
const routingProfiles = [{ directory: "Default", title: "Personal" }, { directory: "Profile 2", title: "Work" }];

function routingSetup({ routing, onSave = () => ({ ok: true }), onIdentify }) {
  const messages = [];
  const harness = setupHarness({ runtime: { async sendMessage(message) {
    messages.push(plain(message));
    if (message.type === "check-profilebar") return { state: "ready", destinationCount: 1, profiles: routingProfiles };
    if (message.type === "get-link-routing") return routing;
    if (message.type === "save-link-routing") return onSave(message);
    if (message.type === "identify-profiles") return onIdentify();
    return undefined;
  } } });
  return { ...harness, messages };
}

const savedRules = {
  version: 1,
  routeFrom: { otherApps: true, webPages: false },
  rules: [
    { id: "a", kind: "host", host: "github.com", pathPrefix: "/team", profileDirectory: "Profile 2" },
    { id: "b", kind: "contains", text: "docs.google.com/a/acme", profileDirectory: "Profile 2" },
  ],
};

test("the setup page lists link-routing rules and saves each edit", async () => {
  const { elements, messages } = routingSetup({
    routing: { status: "connected", profileDirectory: "Default", settings: savedRules },
  });
  await flush();

  assert.equal(elements["#routing"].hidden, false);
  assert.equal(elements["#routing-controls"].hidden, false);
  assert.match(elements["#routing-identity-message"].textContent, /^This is Personal\./);
  assert.equal(elements["#route-other-apps"].checked, true);
  assert.equal(elements["#route-web-pages"].checked, false);
  const rows = elements["#rule-rows"].children;
  assert.deepEqual(rows.map((row) => row.querySelector("input").value), ["github.com/team", "docs.google.com/a/acme"]);
  assert.deepEqual(rows.map((row) => row.querySelectorAll("select")[1].value), ["Profile 2", "Profile 2"]);

  const site = rows[0].querySelector("input");
  site.value = "https://GitHub.com/acme";
  site.listeners.change();
  await flush();
  const saved = messages.at(-1);
  assert.equal(saved.type, "save-link-routing");
  assert.deepEqual(saved.settings.rules[0], {
    id: "a", kind: "host", host: "github.com", pathPrefix: "/acme", profileDirectory: "Profile 2",
  });
  assert.deepEqual(saved.settings.routeFrom, { otherApps: true, webPages: false });
  assert.equal(elements["#routing-result"].textContent, "Saved.");

  elements["#add-rule"].listener();
  assert.equal(elements["#rule-rows"].children.length, 3);
  assert.equal(elements["#rule-rows"].children[2].querySelectorAll("select")[1].value, "Profile 2",
    "a new rule defaults to another profile");
  elements["#route-web-pages"].checked = true;
  elements["#route-web-pages"].listeners.change();
  await flush();
  assert.equal(messages.at(-1).settings.rules.length, 2, "an empty new rule is not saved yet");
  assert.equal(messages.at(-1).settings.routeFrom.webPages, true);

  const linkTest = elements["#link-test"];
  linkTest.value = "https://github.com/acme/repo";
  linkTest.listeners.input();
  assert.equal(elements["#link-test-result"].textContent, "Opens in Work, using the site rule github.com/acme.");
  linkTest.value = "https://accounts.google.com/signin";
  linkTest.listeners.input();
  assert.equal(elements["#link-test-result"].textContent, "Sign-in sites always stay where they open.");
  linkTest.value = "https://example.com/";
  linkTest.listeners.input();
  assert.equal(elements["#link-test-result"].textContent, "No rule matches, so it stays where Chrome opens it.");

  const fallback = elements["#fallback-profile"];
  assert.equal(fallback.value, "", "unmatched links stay where Chrome opens them by default");
  assert.equal(fallback.disabled, false);
  fallback.value = "Profile 2";
  fallback.listeners.change();
  await flush();
  assert.equal(messages.at(-1).settings.fallbackProfileDirectory, "Profile 2");
  assert.equal(elements["#link-test-result"].textContent,
    "No rule matches. From other apps it opens in Work. From web pages it stays where it opened.");
  elements["#route-other-apps"].checked = false;
  elements["#route-other-apps"].listeners.change();
  assert.equal(fallback.disabled, true, "the fallback applies only to links from other apps");
});

test("the setup page shows a rejected rule next to its row", async () => {
  const { elements } = routingSetup({
    routing: { status: "connected", profileDirectory: "Default", settings: savedRules },
    onSave: () => ({ ok: false, ruleIndex: 1, message: "Sign-in sites can’t be routed." }),
  });
  await flush();
  const rows = elements["#rule-rows"].children;
  rows[1].querySelector("input").listeners.change();
  await flush();
  assert.equal(rows[1].querySelector("input").getAttribute("aria-invalid"), "true");
  assert.equal(rows[1].querySelector(".rule-error").textContent, "Sign-in sites can’t be routed.");
  assert.equal(rows[0].querySelector("input").getAttribute("aria-invalid"), "false");
  assert.equal(elements["#routing-result"].textContent, "Not saved. Fix the highlighted rule.");
});

test("an unidentified profile is asked to identify, and the result names profiles that did not answer", async () => {
  const { elements, messages } = routingSetup({
    routing: { status: "connected", profileDirectory: null, settings: { ...savedRules, rules: [] } },
    onIdentify: () => ({ ok: true, identified: ["Default"], unreachable: ["Profile 2"] }),
  });
  await flush();
  assert.match(elements["#routing-identity-message"].textContent, /not identified yet/);
  assert.equal(elements["#no-rules"].hidden, false);

  elements["#identify"].listener();
  await flush();
  assert.ok(messages.some((message) => message.type === "identify-profiles"));
  assert.equal(elements["#identify-result"].textContent,
    "Identified Personal. Work did not answer. Open it in Chrome and try again.");
});

test("an older ProfileBar hides the rules and asks for an update", async () => {
  const { elements } = routingSetup({ routing: { status: "update-required" } });
  await flush();
  assert.equal(elements["#routing-controls"].hidden, true);
  assert.equal(elements["#routing-identity"].hidden, true);
  assert.match(elements["#routing-status"].textContent, /Update ProfileBar to version 1\.5/);
});
