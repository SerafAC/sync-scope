#!/bin/sh
# Staged-pair hook: changes device files between two parts of a staged line.
#
# Usage: change-device-files.sh [<fixture path>]
#   With no argument: flow 08 (feature 006) changes the device Changed source
#   between the confirmation and the deletion. beach.png disappears and
#   sunset.png gets a new mtime, so the deletion reports one file already
#   gone and one changed since the scan.
#   <fixture path>: one file of a device set, named by its fixture path under
#   scan/, for example scan/tree/Album/2024/a4.jpg (staged/10, feature 009),
#   gets the same new mtime. scan/tree/<path> is <path> in the device tree
#   set (TREE_DEVICE_DIR, fixture-images.sh). The path must not start with
#   "/" or contain "..", and the file must exist.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$here/../android-sdk.sh"
. "$here/../fixture-images.sh"

[ "$#" -le 1 ] || {
  printf '%s\n' "Usage: change-device-files.sh [<fixture path>]" >&2
  exit 64
}
device=
if [ "$#" -eq 1 ]; then
  case "$1" in
    '' | /* | *..*)
      printf 'Device path must be relative and stay under scan/: %s\n' "$1" >&2
      exit 64
      ;;
    "$TREE_FIXTURE_PATH"/?*) device="$TREE_DEVICE_DIR/${1#"$TREE_FIXTURE_PATH"/}" ;;
    *)
      printf 'No device set holds %s (expected %s/<path>).\n' "$1" "$TREE_FIXTURE_PATH" >&2
      exit 64
      ;;
  esac
  case "$device" in
    *"'"*)
      printf 'Device path must not contain quotes: %s\n' "$1" >&2
      exit 64
      ;;
  esac
fi

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

if [ -n "$device" ]; then
  adb_shell "[ -f '$device' ] && touch -d @1704153600 '$device'"
  exit 0
fi

changed=/sdcard/SyncScopeE2E/Changed
adb_shell "rm $changed/beach.png"
adb_shell "touch -d @1704153600 $changed/sunset.png"
