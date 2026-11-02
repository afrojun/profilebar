const messages = {
  "unsupported-url": "Only HTTP and HTTPS pages can be moved to another Chrome profile. Nothing was moved.",
  "source-unavailable": "Chrome did not identify the original tab, so nothing was moved.",
  "source-changed": "The destination opened, but an original tab changed during the move. The source tabs were left open.",
  "selection-changed": "The selected tabs changed before the move began. Nothing was moved. Select the tabs and try again.",
  "close-failed": "The destination opened, but Chrome could not close all original tabs. Close any remaining source tabs manually.",
  "profile-changed": "That Chrome profile is no longer available. Right-click the tab and choose Refresh profiles, then try again.",
  "profilebar-unavailable": "Open or install ProfileBar, then right-click the tab and choose Refresh profiles.",
  "open-failed": "ProfileBar could not open the selected pages in that profile. Try again or check that Chrome can open the profile.",
  "profilebar-update-required": "Update ProfileBar to move multiple tabs or a group. The original tabs are still open.",
  "batch-too-large": "This selection is too large to move at once. Select fewer tabs and try again. Nothing was moved.",
  "not-in-group": "This tab is not in a group. Right-click a tab inside the group and try again.",
  "group-changed": "Chrome could not identify that tab group. Nothing was moved. Expand the group and right-click one of its tabs.",
  "group-opened-ungrouped": "The tabs opened in the selected profile without a group. Install ProfileBar for Chrome in that profile to keep the group next time.",
  "sign-in-site": "Sign-in sites can’t be routed, because every profile needs them to sign in. No rule was added.",
  "rule-not-saved": "ProfileBar could not save the rule. Open the ProfileBar for Chrome options to check your rules.",
  "rules-update-required": "Update ProfileBar to add link-routing rules.",
};
const headings = {
  "group-opened-ungrouped": "Tabs moved without a group",
  "sign-in-site": "Could not add the rule",
  "rule-not-saved": "Could not add the rule",
  "rules-update-required": "Could not add the rule",
};

const status = location.hash.slice(1);
if (headings[status]) {
  document.querySelector("#heading").textContent = headings[status];
}
document.querySelector("#detail").textContent = messages[status] ?? messages["open-failed"];
