#!/bin/sh
set -e
if [ ! -f /etc/nginx/conf.d/default.conf ]; then
  echo "BugBerry: /etc/nginx/conf.d/default.conf was not written. With a read-only container, mount a tmpfs on /etc/nginx/conf.d." >&2
  exit 1
fi
