#!/usr/bin/env bash
# Checks that a share link's page still opens within 4 s, with nothing pasted into it, while the api is down:
# refusing connections, unknown to DNS, and with no DNS answering at all. Needs Docker and curl.
#   bash docker/share-api-down-check.sh
set -euo pipefail

IMAGE=bugberry-client:share-api-down-check
PORT="${CHECK_PORT:-18080}"
NETWORK=bugberry-share-check
failures=0

docker build -q -f docker/client.Dockerfile -t "$IMAGE" . >/dev/null
docker network create "$NETWORK" >/dev/null 2>&1 || true

cleanup() {
  docker rm -f bugberry-share-check >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# check <name> <docker run args...>: starts the dashboard alone and opens a share page through it.
check() {
  local name="$1"
  shift
  docker rm -f bugberry-share-check >/dev/null 2>&1 || true
  docker run -d --name bugberry-share-check -p "127.0.0.1:$PORT:80" "$@" "$IMAGE" >/dev/null
  for _ in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.2; done
  local out status seconds body
  out="$(curl -s -m 15 -w '\n%{http_code} %{time_total}' "http://127.0.0.1:$PORT/s/AbCdEf123456")"
  body="${out%$'\n'*}"
  read -r status seconds <<<"${out##*$'\n'}"
  if [ "$status" = 200 ] && [[ "$body" == *'<div id="root">'* ]] && [[ "$body" != *'<!--# include'* ]] &&
    [[ "$body" != *'<html>'*'<html'* ]] && [[ "$body" != *'502 Bad Gateway'* ]] && awk "BEGIN{exit !($seconds < 4)}"; then
    echo "ok    $name (${seconds}s)"
  else
    echo "FAIL  $name: HTTP $status in ${seconds}s"
    failures=$((failures + 1))
  fi
}

check "the api refuses connections" --network "$NETWORK" --add-host api:127.0.0.1
check "the api's name is unknown" --network "$NETWORK"
# On Docker's default network nothing answers at 127.0.0.11, so the lookup waits for resolver_timeout.
check "no DNS answers" --network bridge

docker image rm "$IMAGE" >/dev/null 2>&1 || true
[ "$failures" -eq 0 ]
