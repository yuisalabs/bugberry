#!/usr/bin/env bash
# Checks a running BugBerry install through its front door: the public URL when TRUST_PROXY=true (Caddy or
# another proxy in front), otherwise the client's nginx at http://localhost:<BUGBERRY_PORT>. Going around
# a trusted proxy fails the forged X-Forwarded-For check by design. That check also uses up the share
# rate limit (60 views/minute) for the caller's IP for a minute.
#   bash docker/smoke-test.sh https://bugberry.kantor.com
# Exits 1 when any check fails. Uses only curl, so it runs on the server or from a laptop.
set -euo pipefail

BASE="${1:?usage: docker/smoke-test.sh <base-url>}"
BASE="${BASE%/}"
failures=0

check() {
  local name="$1"
  shift
  if "$@"; then
    echo "ok    $name"
  else
    echo "FAIL  $name"
    failures=$((failures + 1))
  fi
}

# status <path> [curl args...]: prints the HTTP status code only.
status() {
  local path="$1"
  shift
  curl -s -o /dev/null -w '%{http_code}' "$@" "$BASE$path"
}
body() { curl -s "$BASE$1"; }
header() { curl -s -o /dev/null -D - "$BASE$1" | tr -d '\r' | grep -i "^$2:" | cut -d' ' -f2- || true; }

health_ok() { [ "$(status /api/health)" = 200 ] && [ "$(body /api/health)" = '{"ok":true}' ]; }
check "api health through nginx" health_ok

# Bodies go through variables: with pipefail, grep -q closing the pipe early would fail the curl.
shell_ok() { local b; b="$(body "$1")"; [ "$(status "$1")" = 200 ] && [[ "$b" == *'<div id="root">'* ]]; }
root_headers_ok() {
  [ "$(header / x-content-type-options)" = nosniff ] &&
    [ "$(header / x-frame-options)" = DENY ] &&
    [ "$(header / cache-control)" = no-cache ]
}
check "dashboard shell at /" shell_ok /
check "security and cache headers on /" root_headers_ok

for path in /r/abc /s/AbCdEf123456 "/extension/connect?extId=abc"; do
  check "deep link $path gets the shell" shell_ok "$path"
done

asset_cached() {
  local asset
  asset="$(body / | grep -o '/assets/[^"]*\.js' | head -1 || true)"
  [ -n "$asset" ] && [ "$(status "$asset")" = 200 ] && [[ "$(header "$asset" cache-control)" == *immutable* ]]
}
check "hashed assets are cached as immutable" asset_cached

missing_asset_404() { [ "$(status /assets/missing-123.js)" = 404 ] && [[ "$(body /assets/missing-123.js)" != *root* ]]; }
check "a missing asset is a 404, not the shell" missing_asset_404

api_404() { [ "$(status "$1")" = 404 ] && [[ "$(body "$1")" == *'"not_found"'* ]]; }
check "/api answers JSON 404" api_404 /api
check "/api/nope answers JSON 404" api_404 /api/nope

oauth_callback() { [ "$(status "/api/auth/callback/google?code=x&state=y")" = 302 ]; }
check "OAuth callback reaches Better Auth" oauth_callback

large_upload() {
  [ "$(head -c 5242880 /dev/zero | curl -s -o /dev/null -w '%{http_code}' -X PUT -H 'content-type: image/png' \
    --data-binary @- "$BASE/api/uploads/local/invalid-token")" = 401 ]
}
check "a 5 MB upload reaches the api (401 for a bad token, not 413 from nginx)" large_upload

spoofed_forwarded_for() {
  local i
  for i in $(seq 1 60); do status /api/share/smoke-missing -H "X-Forwarded-For: 10.0.0.$i" >/dev/null; done
  [ "$(status /api/share/smoke-missing -H 'X-Forwarded-For: 10.9.9.9')" = 429 ]
}
check "a forged X-Forwarded-For does not escape the share rate limit" spoofed_forwarded_for

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "all checks passed"
