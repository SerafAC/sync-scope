#!/bin/sh
set -eu

protocol=
phase=
state=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --protocol) protocol=${2:-}; shift 2 ;;
    --phase) phase=${2:-}; shift 2 ;;
    --state) state=${2:-}; shift 2 ;;
    *)
      printf 'Unknown manifest argument: %s\n' "$1" >&2
      exit 64
      ;;
  esac
done

case "$protocol" in sftp|webdav|ftp) ;; *) exit 64 ;; esac
case "$phase" in before|after) ;; *) exit 64 ;; esac
case "$state" in /tmp/cloud-sync-checker-*) ;; *) exit 64 ;; esac
[ -d "$state/fixtures" ] || {
  printf '%s\n' "Fixture state is unavailable." >&2
  exit 1
}

manifest_dir="$state/manifests"
mkdir -p "$manifest_dir"
current="$manifest_dir/$protocol.$phase.sha256"
temporary="$current.tmp.$$"
trap 'rm -f "$temporary"' EXIT HUP INT TERM
node "$(dirname "$0")/fixture-manifest.mjs" "$state/fixtures" >"$temporary"
mv "$temporary" "$current"
trap - EXIT HUP INT TERM

if [ "$phase" = after ]; then
  before="$manifest_dir/$protocol.before.sha256"
  [ -f "$before" ] || {
    printf '%s\n' "Before manifest is missing." >&2
    exit 1
  }
  if ! diff -u "$before" "$current"; then
    printf '%s\n' "Fixture manifest detected unexpected remote changes." >&2
    exit 1
  fi
  printf '%s: zero unexpected remote changes\n' "$protocol"
else
  printf '%s: deterministic before manifest recorded\n' "$protocol"
fi
