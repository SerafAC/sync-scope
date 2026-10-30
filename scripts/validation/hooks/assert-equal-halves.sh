#!/bin/sh
# Staged-pair hook (feature 009, research R10, FR-006): fails the line unless
# the sort and view drop-downs each take half of the Files toolbar row on the
# device. Runs between staged/11-toolbar-halves-a and -b, with Files open.
#
# It reads one `uiautomator dump` through adb and finds three nodes by
# resource ID: the row (files-toolbar) and the visible buttons (files-sort,
# files-view). Each button must be 50 % ± 2 % of the row's width. It measures
# the buttons, not their files-sort-control / files-view-control wrappers:
# those have flex: 1 (src/files/ChoiceMenu.tsx) and measure about half the
# row even while the buttons inside them shrink to their content.
#
# Usage: assert-equal-halves.sh
#   ANDROID_SERIAL names the device (android-flow.sh exports it to hooks).
#   SYNCSCOPE_STATE_ROOT is only checked by the usual guard; nothing is read
#   or written there.
set -eu

state=${SYNCSCOPE_STATE_ROOT:-}
case "$state" in
  /tmp/cloud-sync-checker-*) ;;
  *)
    printf '%s\n' "SYNCSCOPE_STATE_ROOT must name owned SyncScope scratch." >&2
    exit 64
    ;;
esac
[ "$#" -eq 0 ] || {
  printf '%s\n' "Usage: assert-equal-halves.sh" >&2
  exit 64
}

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$here/../android-sdk.sh"
android_sdk_resolve
serial=${ANDROID_SERIAL:-}
if [ -z "$serial" ]; then
  printf '%s\n' "ANDROID_SERIAL must name the target device." >&2
  exit 64
fi
adb() {
  timeout --signal=TERM --kill-after=10 60 \
    "$ANDROID_HOME/platform-tools/adb" -s "$serial" "$@"
}
remote=/data/local/tmp/syncscope-equal-halves.xml
adb shell uiautomator dump "$remote" >/dev/null
dump=$(adb exec-out cat "$remote")
adb shell rm -f "$remote" >/dev/null 2>&1 || true

# One node per line, then "<id> <x1> <x2>" for the three IDs. A resource ID
# may carry a package prefix ("<package>:id/files-sort") on some images.
widths=$(printf '%s\n' "$dump" | sed 's/<node /\n<node /g' | awk '
  /^<node / {
    id = $0
    if (!match(id, /resource-id="[^"]*"/)) next
    id = substr(id, RSTART + 13, RLENGTH - 14)
    sub(/^.*:id\//, "", id)
    if (id != "files-toolbar" && id != "files-sort" && id != "files-view") next
    b = $0
    if (!match(b, /bounds="\[-?[0-9]+,-?[0-9]+\]\[-?[0-9]+,-?[0-9]+\]"/)) next
    b = substr(b, RSTART + 8, RLENGTH - 9)
    gsub(/[][]/, " ", b)
    gsub(/,/, " ", b)
    split(b, n, " ")
    print id, n[1], n[3]
  }')

width_of() {
  matches=$(printf '%s\n' "$widths" | awk -v id="$1" '$1 == id { print $3 - $2 }')
  count=$(printf '%s\n' "$matches" | grep -c . || true)
  if [ "$count" -ne 1 ]; then
    printf 'Expected one visible %s in the dump, found %s.\n' "$1" "$count" >&2
    exit 1
  fi
  if [ "$matches" -le 0 ]; then
    printf '%s has no width in the dump.\n' "$1" >&2
    exit 1
  fi
  printf '%s\n' "$matches"
}

toolbar=$(width_of files-toolbar)
sort_width=$(width_of files-sort)
view_width=$(width_of files-view)

# 50 % ± 2 %: 48 * toolbar <= 100 * button <= 52 * toolbar, in integers.
status=0
for pair in "files-sort $sort_width" "files-view $view_width"; do
  id=${pair% *}
  width=${pair#* }
  share=$(awk -v w="$width" -v t="$toolbar" 'BEGIN { printf "%.1f", 100 * w / t }')
  if [ $((100 * width)) -lt $((48 * toolbar)) ] || [ $((100 * width)) -gt $((52 * toolbar)) ]; then
    printf '%s is %s px, %s %% of files-toolbar (%s px); expected 50 %% +/- 2 %%.\n' \
      "$id" "$width" "$share" "$toolbar" >&2
    status=1
  else
    printf '%s is %s px, %s %% of files-toolbar (%s px).\n' "$id" "$width" "$share" "$toolbar"
  fi
done
exit "$status"
