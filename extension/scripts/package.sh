#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
version=$(awk -F'"' '/"version"/ { print $4; exit }' "$root/manifest.json")
archive="$root/dist/profilebar-for-chrome-$version.zip"

mkdir -p "$root/dist"
cd "$root"

zip -q -FS "$archive" \
  background.js \
  group-receiver.html \
  group-receiver.js \
  icons/icon-16.png \
  icons/icon-32.png \
  icons/icon-48.png \
  icons/icon-128.png \
  manifest.json \
  move-status.html \
  move-status.js \
  setup.css \
  setup.html \
  setup.js
# The repository licence sits one level up; store it at the archive root.
zip -q -j "$archive" ../LICENSE

printf '%s\n' "$archive"
