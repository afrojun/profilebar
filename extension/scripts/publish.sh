#!/usr/bin/env bash
set -euo pipefail

: "${CWS_ACCESS_TOKEN:?Missing Chrome Web Store access token}"
: "${CWS_PUBLISHER_ID:?Missing Chrome Web Store publisher ID}"
: "${CWS_EXTENSION_ID:?Missing Chrome Web Store extension ID}"
: "${CWS_ARCHIVE:?Missing extension archive}"

item="publishers/$CWS_PUBLISHER_ID/items/$CWS_EXTENSION_ID"
api="https://chromewebstore.googleapis.com/v2/$item"
upload_api="https://chromewebstore.googleapis.com/upload/v2/$item"
auth_header="Authorization: Bearer $CWS_ACCESS_TOKEN"

api_request() {
  local action="$1" response status body message
  shift
  response=$(curl --silent --show-error --write-out '\n%{http_code}' "$@")
  status=${response##*$'\n'}
  body=${response%$'\n'*}
  if [[ "$status" != 2* ]]; then
    message=$(jq -r '.error.message // empty' <<< "$body" 2>/dev/null || true)
    printf 'Chrome Web Store %s failed (HTTP %s): %s\n' \
      "$action" "$status" "${message:-No error message returned}" >&2
    return 1
  fi
  printf '%s' "$body"
}

response=$(api_request upload \
  -H "$auth_header" -X POST -T "$CWS_ARCHIVE" "$upload_api:upload")
upload_state=$(jq -r '.uploadState // empty' <<< "$response")

if [[ "$upload_state" == "IN_PROGRESS" ]]; then
  for _ in {1..30}; do
    sleep 10
    response=$(api_request status -H "$auth_header" "$api:fetchStatus")
    upload_state=$(jq -r '.lastAsyncUploadState // empty' <<< "$response")
    if [[ "$upload_state" != "IN_PROGRESS" ]]; then
      break
    fi
  done
fi

if [[ "$upload_state" != "SUCCEEDED" ]]; then
  echo "Chrome Web Store upload did not succeed (state: ${upload_state:-missing})" >&2
  exit 1
fi

response=$(api_request publish \
  -H "$auth_header" -H 'Content-Type: application/json' \
  -X POST -d '{"publishType":"DEFAULT_PUBLISH"}' "$api:publish")
publish_state=$(jq -r '.state // empty' <<< "$response")
if [[ "$publish_state" != "PENDING_REVIEW" && "$publish_state" != "PUBLISHED" ]]; then
  echo "Unexpected Chrome Web Store submission state: ${publish_state:-missing}" >&2
  exit 1
fi
echo "Chrome Web Store submission accepted (state: $publish_state)."
