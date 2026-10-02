#!/bin/sh
# Staged-pair hook for flow 06 (feature 006, contracts/maestro-mvp.md): deletes
# recheck/beach.png from the host fixture tree. The tree is bind-mounted
# read-only into every container, so the servers see the removal at once.
# restore-recheck-file.sh puts it back before the next API level and before
# the services' after-manifest check.
set -eu

state=${SYNCSCOPE_STATE_ROOT:-}
case "$state" in
  /tmp/cloud-sync-checker-*) ;;
  *)
    printf '%s\n' "SYNCSCOPE_STATE_ROOT must name owned SyncScope scratch." >&2
    exit 64
    ;;
esac

rm -- "$state/fixtures/recheck/beach.png"
