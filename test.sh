#!/bin/zsh
set -euo pipefail
project_dir="${0:A:h}"
test_binary="$(mktemp /private/tmp/profilebar-tests.XXXXXX)"
trap 'rm -f -- "$test_binary"' EXIT
xcrun swift-format lint --strict --configuration "$project_dir/.swift-format" \
  --recursive "$project_dir/Sources" "$project_dir/Tests"
swiftc -warnings-as-errors \
  -framework AppKit -framework ApplicationServices -framework Carbon \
  "$project_dir/Sources/ProfileBar/ChromeProfile.swift" \
  "$project_dir/Sources/ProfileBar/NativeHostRegistration.swift" \
  "$project_dir/Sources/NativeHost/ProfileBridge.swift" \
  "$project_dir/Sources/NativeHost/ChromeFocusedProfile.swift" \
  "$project_dir/Sources/NativeHost/GroupHandoff.swift" \
  "$project_dir/Sources/ProfileBar/ChromeWindowTitleMatcher.swift" \
  "$project_dir/Sources/ProfileBar/ProfileBarSymbol.swift" \
  "$project_dir/Sources/ProfileBar/ProfileShortcut.swift" \
  "$project_dir/Sources/ProfileBar/UpdateChecker.swift" \
  "$project_dir/Tests/ProfileBarTests.swift" \
  -o "$test_binary"
"$test_binary"
