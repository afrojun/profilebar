// Split views, which Chrome shows as two tabs side by side. A move sends them to ProfileBar as pairs of neighbouring
// positions in its URL list, and the destination's copy of this extension splits those tabs again.
const TabSplits = (() => {
  function isSplit(tab) {
    return Number.isInteger(tab?.splitViewId) && tab.splitViewId !== -1;
  }

  // Takes tabs in tab-strip order, where the two halves of a split view are always next to each other.
  function pairs(tabs) {
    const found = [];
    for (let index = 0; index + 1 < tabs.length; index += 1) {
      if (isSplit(tabs[index]) && tabs[index + 1].splitViewId === tabs[index].splitViewId) {
        found.push([index, index + 1]);
        index += 1;
      }
    }
    return found;
  }

  // The tabs are already open, so a split that Chrome cannot make leaves them as separate tabs. Chrome 155 added
  // createSplit, and older ProfileBar versions send no splits.
  async function rebuild(tabIds, splits) {
    if (!chrome.tabs.createSplit || !Array.isArray(splits)) return;
    for (const [first, second] of splits) {
      await chrome.tabs.createSplit([tabIds[first], tabIds[second]]).catch((error) => {
        console.debug("Could not split the moved tabs:", error);
      });
    }
  }

  return { isSplit, pairs, rebuild };
})();
