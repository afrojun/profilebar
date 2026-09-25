#!/bin/zsh
set -euo pipefail

project_dir="${0:A:h}"
variant="${1:-}"
if (( $# > 1 )); then
  print -u2 "Usage: $0 [--dev | --release]"
  exit 2
fi

case "$variant" in
  "" | --dev)
    variant=dev
    app_name="ProfileBar Dev"
    dev_bundle_id="dev.afrojun.ProfileBar.dev"
    icon_name="AppIconDev.icns"
    ;;
  --release)
    variant=release
    app_name="ProfileBar"
    icon_name="AppIcon.icns"
    ;;
  *)
    print -u2 "Usage: $0 [--dev | --release]"
    exit 2
    ;;
esac

app_dir="$project_dir/build/$app_name.app"
contents_dir="$app_dir/Contents"
local_identity="ProfileBar Local Signing"
minimum_macos_version="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$project_dir/Info.plist")"
signing_identities="$(security find-identity -v -p codesigning 2>/dev/null || true)"
developer_id_identity="$(
  print -r -- "$signing_identities" |
    sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p' |
    sed -n '1p'
)"

if [[ -n "${PROFILEBAR_SIGNING_IDENTITY:-}" ]]; then
  signing_identity="$PROFILEBAR_SIGNING_IDENTITY"
elif [[ "$variant" == dev && "$signing_identities" == *"\"$local_identity\""* ]]; then
  signing_identity="$local_identity"
elif [[ "$variant" == release && -n "$developer_id_identity" ]]; then
  signing_identity="$developer_id_identity"
elif [[ "$variant" == release ]]; then
  print -u2 "A Developer ID Application certificate is required for a release build."
  print -u2 "Set PROFILEBAR_SIGNING_IDENTITY=- only for an ad-hoc CI check."
  exit 1
else
  signing_identity="-"
fi

if [[ "$variant" == release \
  && "$signing_identity" != "-" \
  && "$signing_identity" != "Developer ID Application:"* ]]; then
  print -u2 "A release build must use a Developer ID Application certificate."
  exit 1
fi

if [[ "$signing_identity" == "-" ]]; then
  if [[ "$variant" == dev ]]; then
    print -u2 "Warning: signing ad hoc; run ./setup-signing.sh to keep Accessibility access across builds."
  else
    print -u2 "Warning: the release build is signed ad hoc and cannot be distributed."
  fi
fi

rm -rf -- "$app_dir"
mkdir -p "$contents_dir/MacOS" "$contents_dir/Resources"
swiftc -target "arm64-apple-macos${minimum_macos_version}" -O -warnings-as-errors \
  -framework AppKit -framework ApplicationServices -framework Carbon -framework ServiceManagement \
  "$project_dir/Sources/ProfileBar/ChromeProfile.swift" \
  "$project_dir/Sources/ProfileBar/GlobalHotKeyRegistrar.swift" \
  "$project_dir/Sources/ProfileBar/ChromeWindowTitleMatcher.swift" \
  "$project_dir/Sources/ProfileBar/ProfileBarSymbol.swift" \
  "$project_dir/Sources/ProfileBar/ProfileAvatarRenderer.swift" \
  "$project_dir/Sources/ProfileBar/ProfileShortcut.swift" \
  "$project_dir/Sources/ProfileBar/ShortcutRecorderButton.swift" \
  "$project_dir/Sources/ProfileBar/SettingsWindowController.swift" \
  "$project_dir/Sources/ProfileBar/UpdateChecker.swift" \
  "$project_dir/Sources/ProfileBar/main.swift" \
  -o "$contents_dir/MacOS/ProfileBar"

cp "$project_dir/Info.plist" "$contents_dir/Info.plist"
if [[ "$variant" == dev ]]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName $app_name" "$contents_dir/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleName $app_name" "$contents_dir/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $dev_bundle_id" "$contents_dir/Info.plist"
fi
cp "$project_dir/Resources/$icon_name" "$contents_dir/Resources/AppIcon.icns"
signing_options=(--force --sign "$signing_identity")
if [[ "$signing_identity" == "Developer ID Application:"* ]]; then
  signing_options+=(--options runtime --timestamp)
fi
codesign "${signing_options[@]}" "$app_dir"
print "$app_dir"
