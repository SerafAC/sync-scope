#!/bin/sh
# Undoes remove-recheck-file.sh: copies gallery/beach.png back to
# recheck/beach.png and resets the directory mtime, so the fixture tree matches
# what fixture-seed.sh wrote. The protocol services compare that tree with
# their before-manifest when they stop, and the next API level runs flow 06
# against the same tree. A no-op when the file is present.
set -eu

state=${SYNCSCOPE_STATE_ROOT:-}
case "$state" in
  /tmp/cloud-sync-checker-*) ;;
  *)
    printf '%s\n' "SYNCSCOPE_STATE_ROOT must name owned SyncScope scratch." >&2
    exit 64
    ;;
esac

recheck="$state/fixtures/recheck"
[ -d "$recheck" ] || exit 0
[ ! -e "$recheck/beach.png" ] || exit 0
cp -p -- "$state/fixtures/gallery/beach.png" "$recheck/beach.png"
touch -d '@1704067200.000000000' "$recheck"
