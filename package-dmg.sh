#!/bin/zsh
set -euo pipefail

project_dir="${0:A:h}"
app="${1:-$project_dir/build/ProfileBar.app}"
output="${2:-$project_dir/dist/ProfileBar.dmg}"
background="$project_dir/Resources/DMG/background.svg"

if [[ ! -d "$app" ]]; then
  print -u2 "App not found: $app"
  exit 1
fi

bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist" 2>/dev/null || true)"
if [[ "$bundle_id" != "dev.afrojun.ProfileBar" ]]; then
  print -u2 "A DMG can only be made from the release app."
  exit 1
fi

work="$(mktemp -d /private/tmp/profilebar-dmg.XXXXXX)"
contents="$work/contents"
mount="$work/mount"
writable="$work/ProfileBar-rw.dmg"
mounted=false
cleanup() {
  if [[ "$mounted" == true ]]; then
    hdiutil detach "$mount" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$work"
}
trap cleanup EXIT

mkdir -p "${output:h}"
mkdir -p "$contents/.background" "$mount"
ditto "$app" "$contents/ProfileBar.app"
ln -s /Applications "$contents/Applications"
sips -s format png "$background" --out "$contents/.background/background.png" >/dev/null
hdiutil create \
  -volname ProfileBar \
  -srcfolder "$contents" \
  -format UDRW \
  "$writable" >/dev/null

hdiutil attach "$writable" -readwrite -noverify -noautoopen -mountpoint "$mount" >/dev/null
mounted=true
osascript - "$mount" <<'APPLESCRIPT'
on run arguments
  set mountPath to item 1 of arguments
  set dmgFolder to POSIX file mountPath as alias
  set backgroundFile to POSIX file (mountPath & "/.background/background.png") as alias
  tell application "Finder"
    open dmgFolder
    set dmgWindow to container window of dmgFolder
    tell dmgWindow
      set current view to icon view
      set toolbar visible to false
      set statusbar visible to false
      set pathbar visible to false
      set bounds to {100, 100, 700, 460}
    end tell
    set viewOptions to icon view options of dmgWindow
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to 112
    set text size of viewOptions to 14
    set background picture of viewOptions to backgroundFile
    set position of item "ProfileBar.app" of dmgFolder to {165, 195}
    set position of item "Applications" of dmgFolder to {435, 195}
    update dmgFolder without registering applications
    delay 2
    close dmgWindow
  end tell
end run
APPLESCRIPT

# Finder can keep the volume busy for a moment after it lays out the window, so the detach is retried.
detached=false
for attempt in {1..10}; do
  if hdiutil detach "$mount" >/dev/null 2>&1; then
    detached=true
    break
  fi
  sleep 1
done
[[ "$detached" == true ]] || hdiutil detach "$mount" -force >/dev/null
mounted=false
hdiutil convert "$writable" \
  -format UDZO \
  -ov \
  -o "$output" >/dev/null
print "created: $output"
