#!/bin/sh
# Staged-pair hook for flow 08 (feature 006): changes the device Changed source
# between the confirmation and the deletion. beach.png disappears and
# sunset.png gets a new mtime, so the deletion reports one file already gone
# and one changed since the scan.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$here/../android-sdk.sh"
android_sdk_resolve

serial=${ANDROID_SERIAL:-}
if [ -z "$serial" ]; then
  printf '%s\n' "ANDROID_SERIAL must name the target device." >&2
  exit 64
fi

adb_shell() {
  timeout --signal=TERM --kill-after=10 60 \
    "$ANDROID_HOME/platform-tools/adb" -s "$serial" shell "$1"
}

changed=/sdcard/SyncScopeE2E/Changed
adb_shell "rm $changed/beach.png"
adb_shell "touch -d @1704153600 $changed/sunset.png"
