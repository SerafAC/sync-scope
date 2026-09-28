#!/bin/sh
# Seeds the SAF source fixtures the Maestro flows pick (research R12).
#
# Creates SyncScopeE2E/Camera and SyncScopeE2E/Camera/Nested on primary shared
# storage and SyncScopeE2E/Camera on the public removable volume, each with one
# small file. The same folder name on two volumes exercises alias
# disambiguation; the nested folder exercises the overlap rule.
#
# Targets the device in ANDROID_SERIAL. Idempotent: directories use mkdir -p
# and fixture files are overwritten. Fails loudly when no public removable
# volume is mounted (R10: never skip removable-storage coverage).
set -eu

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/android-sdk.sh"
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

seed_dir() {
  dir=$1
  file=$2
  adb_shell "mkdir -p $dir"
  adb_shell "printf 'SyncScope e2e fixture\n' > $dir/$file"
}

volumes=$(adb_shell "sm list-volumes public" | tr -d '\r')
uuid=$(printf '%s\n' "$volumes" | awk '$2 == "mounted" && $3 != "" && $3 != "null" { print $3; exit }')
if [ -z "$uuid" ]; then
  printf '%s\n' \
    "No public removable volume is mounted on $serial (sm list-volumes public)." \
    "Create the AVD with hw.sdCard = yes and sdcard.size = 512 MB; see DEVELOPMENT.md." >&2
  exit 1
fi

seed_dir /sdcard/SyncScopeE2E/Camera camera.txt
seed_dir /sdcard/SyncScopeE2E/Camera/Nested nested.txt
seed_dir "/storage/$uuid/SyncScopeE2E/Camera" camera.txt

printf '%s\n' "Seeded SyncScopeE2E fixtures on primary storage and /storage/$uuid."
