const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function runScript(file, context) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  vm.runInNewContext(source, context);
}

test("manifest requires ProfileBar access and no page access", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "ProfileBar for Chrome");
  assert.ok(manifest.description.length <= 132);
  assert.deepEqual(manifest.permissions, ["contextMenus", "nativeMessaging", "tabGroups", "tabs"]);
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
      async group(options) { calls.push(["group", options]); return 22; },
      async remove(ids) { calls.push(["remove", ids]); },
    },
    tabGroups: {
      async update(id, details) { calls.push(["update", id, details]); },
    },
  };

  runScript("group-receiver.js", {
    chrome,
    location: { hash: `#${token}`, pathname: "/group-receiver.html" },
    history: { replaceState() {} },
    console,
  });
  await new Promise(setImmediate);

  assert.deepEqual(calls.filter(([type]) => type === "create").map(([, options]) => options.url), [
    "https://example.com/first", "https://example.com/second",
  ]);
  assert.deepEqual(Array.from(calls.find(([type]) => type === "group")[1].tabIds), [11, 12]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.find(([type]) => type === "update")[2])), {
    title: "Research", color: "blue", collapsed: true,
  });
  assert.equal(calls.findIndex(([type, , message]) => type === "native" && message.type === "completeGroup")
    > calls.findIndex(([type]) => type === "update"), true);
  assert.deepEqual(calls.at(-1), ["remove", 7]);
});

test("a failed destination group removes created tabs and reports failure", async () => {
  const calls = [];
  const chrome = {
    runtime: {
      getManifest() { return { update_url: "https://clients2.google.com/service/update2/crx" }; },
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
        if (options.url.endsWith("second")) throw new Error("Chrome could not create the tab");
        return { id: 11 };
      },
      async remove(ids) { calls.push(["remove", ids]); },
    },
  };

  runScript("group-receiver.js", {
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

function fakeElement() {
  const element = {
    dataset: {},
    hidden: false,
    disabled: false,
    textContent: "",
    children: [],
    addEventListener(type, listener) { element.listener = listener; },
    replaceChildren(...children) { element.children = children; },
  };
  return element;
}

function setupHarness(chrome) {
  const elements = {};
  for (const selector of [
    "#status", "#heading", "#intro", "#steps", "#check", "#get-profilebar",
    "#shared-names", "#shared-names-message", "#shared-names-actions", "#shared-names-result",
  ]) {
    elements[selector] = fakeElement();
  }
  const listeners = {};
  runScript("setup.js", {
    chrome,
    console: { error() {} },
    document: { querySelector: (selector) => elements[selector], createElement: fakeElement },
    Intl,
    window: { addEventListener(type, listener) { listeners[type] = listener; } },
  });
  return { elements, listeners };
}

test("the setup page shows connected profiles without setup steps", async () => {
  const { elements } = setupHarness({
    runtime: { async sendMessage(message) {
      assert.equal(message.type, "check-profilebar");
      return { state: "ready", destinationCount: 1 };
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
  runScript("move-status.js", { document, location: { hash: "#group-opened-ungrouped" } });
  assert.equal(elements["#heading"].textContent, "Tabs moved without a group");
  assert.match(elements["#detail"].textContent, /Install ProfileBar for Chrome in that profile/);

  runScript("move-status.js", { document, location: { hash: "#unknown" } });
  assert.match(elements["#detail"].textContent, /could not open the selected pages/);
});
