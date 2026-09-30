#!/bin/sh
set -eu

root=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --root)
      root=${2:-}
      shift 2
      ;;
    *)
      printf 'Unknown fixture seed argument: %s\n' "$1" >&2
      exit 64
      ;;
  esac
done

case "$root" in
  /tmp/cloud-sync-checker-*) ;;
  *)
    printf '%s\n' "Fixture root must be owned SyncScope scratch." >&2
    exit 64
    ;;
esac

if [ -e "$root" ] && [ "$(find "$root" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  printf '%s\n' "Fixture root must be empty." >&2
  exit 1
fi

umask 022
mkdir -p \
  "$root/flat" \
  "$root/nested/alpha" \
  "$root/duplicates/a" \
  "$root/duplicates/b" \
  "$root/unicode" \
  "$root/mismatch" \
  "$root/timestamps" \
  "$root/non-regular" \
  "$root/.hidden/descendants" \
  "$root/scan/clean/a" \
  "$root/scan/clean/b" \
  "$root/scan/partial/readable" \
  "$root/scan/partial/restricted"

printf '%s\n' 'exact metadata fixture' >"$root/flat/exact.txt"
printf '%s\n' 'nested metadata fixture' >"$root/nested/alpha/nested.txt"
printf '%s\n' 'reusable duplicate payload' >"$root/duplicates/a/reusable.jpg"
cp "$root/duplicates/a/reusable.jpg" "$root/duplicates/b/reusable.jpg"
printf '%s\n' 'composed unicode metadata' >"$root/unicode/Grüße_日本_é.txt"
printf '%s\n' 'decomposed unicode metadata' >"$root/unicode/é-decomposed.txt"
printf '%s\n' 'intentionally different size' >"$root/mismatch/size-mismatch.txt"
printf '%s' 'bucket start' >"$root/timestamps/bucket-start.bin"
printf '%s' 'bucket end' >"$root/timestamps/bucket-end.bin"
printf '%s\n' 'hidden metadata fixture' >"$root/.hidden/descendants/hidden.txt"
ln -s ../../outside-root-sentinel.txt "$root/non-regular/escape-link"
mkfifo "$root/non-regular/named-pipe"

# Scan fixtures (feature 004, research R11). The clean tree mirrors the device
# SyncScopeE2E/Scan source; the decomposed name is stored in NFD on purpose.
printf '%s\n' 'exact metadata fixture' >"$root/scan/clean/exact.txt"
printf '%s\n' 'reusable duplicate payload' >"$root/scan/clean/a/reusable.jpg"
cp "$root/scan/clean/a/reusable.jpg" "$root/scan/clean/b/reusable.jpg"
printf '%s\n' 'decomposed unicode metadata' >"$root/scan/clean/é-decomposed.txt"
printf '%s\n' 'intentionally different size' >"$root/scan/clean/size-mismatch.txt"
printf '%s\n' 'exact metadata fixture' >"$root/scan/partial/readable/exact.txt"
printf '%s\n' 'only in restricted' >"$root/scan/partial/restricted/only-here.txt"

# The host owner retains cleanup rights. Container accounts map to different
# UIDs and receive only read/execute bits, while each server also enforces its
# protocol-level read-only mode.
find "$root" -type d -exec chmod 0755 {} +
find "$root" -type f -exec chmod 0644 {} +
# Host-owned and closed to the container accounts, so every server reports a
# real permission error for this one directory.
chmod 0700 "$root/scan/partial/restricted"
touch -d '@1704067200.000000000' \
  "$root/flat/exact.txt" \
  "$root/nested/alpha/nested.txt" \
  "$root/duplicates/a/reusable.jpg" \
  "$root/duplicates/b/reusable.jpg" \
  "$root/unicode/Grüße_日本_é.txt" \
  "$root/unicode/é-decomposed.txt" \
  "$root/mismatch/size-mismatch.txt" \
  "$root/.hidden/descendants/hidden.txt" \
  "$root/scan/clean/exact.txt" \
  "$root/scan/clean/a/reusable.jpg" \
  "$root/scan/clean/b/reusable.jpg" \
  "$root/scan/clean/é-decomposed.txt" \
  "$root/scan/clean/size-mismatch.txt" \
  "$root/scan/partial/readable/exact.txt" \
  "$root/scan/partial/restricted/only-here.txt"
touch -d '@1704067200.000000000' "$root/timestamps/bucket-start.bin"
touch -d '@1704067200.999000000' "$root/timestamps/bucket-end.bin"
touch -h -d '@1704067200.000000000' "$root/non-regular/escape-link"
touch -d '@1704067200.000000000' "$root/non-regular/named-pipe"
find "$root" -depth -type d -exec touch -d '@1704067200.000000000' {} +
