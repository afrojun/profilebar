// Link-routing rule matching, shared by the service worker and the setup page. It follows the precedence in
// docs/link-routing-design.md, and Chrome's request blocking uses the same order through rule priorities.
const RoutingRules = (() => {
  // Every profile needs these to sign in, so they are never routed. Keep this list in sync with
  // LinkRoutingSettings.signInHosts in Sources/ProfileBar/LinkRouting.swift.
  const SIGN_IN_HOSTS = ["accounts.google.com", "login.microsoftonline.com", "login.live.com", "appleid.apple.com", "okta.com"];

  function isWebUrl(url) {
    return typeof url === "string" && /^https?:\/\//i.test(url);
  }

  function isSignInUrl(url) {
    const host = new URL(url).hostname.toLowerCase();
    return SIGN_IN_HOSTS.some((signInHost) => host === signInHost || host.endsWith(`.${signInHost}`));
  }

  // A web link that is not a sign-in site. Rules and the fallback profile apply only to these.
  function isRoutable(url) {
    return isWebUrl(url) && !isSignInUrl(url);
  }

  // Host rules win over "URL contains" rules. Longer hosts, paths, and text are more specific. List order breaks ties.
  function rankedRules(rules) {
    return rules
      .map((rule, index) => ({ rule, index }))
      .sort((a, b) => compareSpecificity(a.rule, b.rule) || a.index - b.index)
      .map(({ rule }) => rule);
  }

  function compareSpecificity(a, b) {
    if (a.kind !== b.kind) return a.kind === "host" ? -1 : 1;
    if (a.kind === "host") return b.host.length - a.host.length || b.pathPrefix.length - a.pathPrefix.length;
    return b.text.length - a.text.length;
  }

  // Chrome matches request filters without regard to case and without the URL fragment, so these do too.
  function matches(rule, url) {
    const parsed = new URL(url);
    parsed.hash = "";
    if (rule.kind === "host") {
      const host = parsed.hostname.toLowerCase();
      return (host === rule.host || host.endsWith(`.${rule.host}`))
        && parsed.pathname.toLowerCase().startsWith(rule.pathPrefix.toLowerCase());
    }
    return parsed.href.toLowerCase().includes(rule.text.toLowerCase());
  }

  function winningRule(rules, url) {
    if (!isRoutable(url)) return null;
    return rankedRules(rules).find((rule) => matches(rule, url)) ?? null;
  }

  // Chrome applies the highest-priority matching rule, so it picks the same winner as winningRule. A rule for
  // another profile blocks the request, and a rule for this profile allows it over any lower-priority block.
  // Sign-in sites are allowed above every rule.
  function sessionRules(rules, profileDirectory, excludedTabIds) {
    if (rules.length === 0) return [];
    const ranked = rankedRules(rules);
    const blocking = ranked.map((rule, index) => ({
      id: index + 1,
      priority: ranked.length - index,
      action: { type: rule.profileDirectory === profileDirectory ? "allow" : "block" },
      condition: { ...requestFilter(rule), isUrlFilterCaseSensitive: false, resourceTypes: ["main_frame"], excludedTabIds },
    }));
    const signIn = {
      id: ranked.length + 1,
      priority: ranked.length + 1,
      action: { type: "allow" },
      condition: { requestDomains: SIGN_IN_HOSTS, resourceTypes: ["main_frame"], excludedTabIds },
    };
    return [...blocking, signIn];
  }

  function requestFilter(rule) {
    if (rule.kind === "contains") return { urlFilter: rule.text };
    if (!rule.pathPrefix) return { urlFilter: `||${rule.host}^` };
    // A URL filter cannot allow a port between the host and the path, so a path is matched with a pattern.
    const path = rule.pathPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return { requestDomains: [rule.host], regexFilter: `^https?://[^/?#]+${path}` };
  }

  // Reads a site typed as "github.com/team" or pasted as a URL.
  function parseSite(site) {
    const value = site.trim().replace(/^https?:\/\//i, "");
    const slash = value.indexOf("/");
    const host = slash === -1 ? value : value.slice(0, slash);
    const pathPrefix = slash === -1 ? "" : value.slice(slash);
    return { host: host.toLowerCase(), pathPrefix: pathPrefix === "/" ? "" : pathPrefix };
  }

  function siteText(rule) {
    return `${rule.host}${rule.pathPrefix}`;
  }

  return { isWebUrl, isSignInUrl, isRoutable, winningRule, sessionRules, parseSite, siteText };
})();
