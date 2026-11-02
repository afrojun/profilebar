const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "routing-rules.js"), "utf8");
const RoutingRules = vm.runInNewContext(`${source}\nRoutingRules`, { URL });

const host = (hostName, profileDirectory, pathPrefix = "") =>
  ({ id: hostName + pathPrefix, kind: "host", host: hostName, pathPrefix, profileDirectory });
const contains = (text, profileDirectory) => ({ id: text, kind: "contains", text, profileDirectory });

const routingCases = require("./routing-cases.json");

for (const group of routingCases.groups) {
  test(group.name, () => {
    for (const { url, rule } of group.cases) {
      assert.equal(RoutingRules.winningRule(group.rules, url)?.id ?? null, rule, url);
    }
  });
}

test("request blocking uses the same order, blocking other profiles' rules and allowing this profile's", () => {
  const rules = [contains("acme", "Work"), host("github.com", "Default", "/me"), host("github.com", "Work")];
  const sessionRules = RoutingRules.sessionRules(rules, "Default", [-1, 4]);
  const shared = { isUrlFilterCaseSensitive: false, resourceTypes: ["main_frame"], excludedTabIds: [-1, 4] };
  assert.deepEqual(JSON.parse(JSON.stringify(sessionRules)), [
    { id: 1, priority: 3, action: { type: "allow" },
      condition: { requestDomains: ["github.com"], regexFilter: "^https?://[^/?#]+/me", ...shared } },
    { id: 2, priority: 2, action: { type: "block" }, condition: { urlFilter: "||github.com^", ...shared } },
    { id: 3, priority: 1, action: { type: "block" }, condition: { urlFilter: "acme", ...shared } },
    { id: 4, priority: 4, action: { type: "allow" },
      condition: {
        requestDomains: ["accounts.google.com", "login.microsoftonline.com", "login.live.com", "appleid.apple.com",
          "okta.com"],
        resourceTypes: ["main_frame"], excludedTabIds: [-1, 4],
      } },
  ]);
  assert.equal(RoutingRules.sessionRules([], "Default", [-1]).length, 0, "no rules means nothing to block");
});

test("a path pattern escapes the path, so a dot in it matches only a dot", () => {
  const [rule] = RoutingRules.sessionRules([host("example.com", "Work", "/a.b")], "Default", [-1]);
  const pattern = new RegExp(rule.condition.regexFilter, "i");
  assert.ok(pattern.test("https://example.com:8443/A.b/page"), "a port may come between the site and the path");
  assert.ok(!pattern.test("https://example.com/axb"));
});

test("a typed site is split into its host and path", () => {
  assert.deepEqual({ ...RoutingRules.parseSite(" https://GitHub.com/team ") }, { host: "github.com", pathPrefix: "/team" });
  assert.deepEqual({ ...RoutingRules.parseSite("example.com/") }, { host: "example.com", pathPrefix: "" });
  assert.equal(RoutingRules.siteText(host("github.com", "Work", "/team")), "github.com/team");
});
