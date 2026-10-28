#!/bin/sh
# Staged-pair hook: deletes one file from the host fixture tree. The tree is
# bind-mounted read-only into every container, so the servers see the removal
# at once. restore-recheck-file.sh (with the same path) puts it back before
# the next API level and before the services' after-manifest check.
#
# Usage: remove-recheck-file.sh [<fixture path>]
#   With no argument: recheck/beach.png, for flow 06 (feature 006,
#   contracts/maestro-mvp.md).
#   <fixture path>: a file relative to the fixture root, for example
#   scan/tree/Album/2025/new.jpg for the resync line (feature 009). It must
#   not start with "/" or contain "..".
# A no-op when the file is already absent.
set -eu

state=${SYNCSCOPE_STATE_ROOT:-}
case "$state" in
  /tmp/cloud-sync-checker-*) ;;
  *)
    printf '%s\n' "SYNCSCOPE_STATE_ROOT must name owned SyncScope scratch." >&2
    exit 64
    ;;
esac

[ "$#" -le 1 ] || {
  printf '%s\n' "Usage: remove-recheck-file.sh [<fixture path>]" >&2
  exit 64
}
path=${1-recheck/beach.png}
case "$path" in
  '' | /* | *..*)
    printf 'Fixture path must be relative and stay in the fixture tree: %s\n' "$path" >&2
    exit 64
    ;;
esac

target="$state/fixtures/$path"
[ -e "$target" ] || exit 0
rm -- "$target"
