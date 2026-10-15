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
};

const status = location.hash.slice(1);
if (status === "group-opened-ungrouped") {
  document.querySelector("#heading").textContent = "Tabs moved without a group";
}
document.querySelector("#detail").textContent = messages[status] ?? messages["open-failed"];
