#!/bin/sh
# Seeds the SAF source fixtures the Maestro flows pick (research R12).
#
# Creates SyncScopeE2E/Camera and SyncScopeE2E/Camera/Nested on primary shared
# storage and SyncScopeE2E/Camera on the public removable volume, each with one
# small file. The same folder name on two volumes exercises alias
# disambiguation; the nested folder exercises the overlap rule.
#
# Feature 004 (research R11) adds SyncScopeE2E/Scan, the device side of the
# remote scan/clean fixtures (same names, sizes and mtimes, with the unicode
# name in NFC), and SyncScopeE2E/Bulk, BULK_FILES generated files spread over
# 200 directories for the progress and backgrounding flows.
#
# Targets the device in ANDROID_SERIAL. Idempotent: directories use mkdir -p,
# fixture files are overwritten and the bulk tree is regenerated from scratch.
# Fails loudly when no public removable volume is mounted (R10: never skip
# removable-storage coverage).
set -eu

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/android-sdk.sh"
android_sdk_resolve

serial=${ANDROID_SERIAL:-}
if [ -z "$serial" ]; then
  printf '%s\n' "ANDROID_SERIAL must name the target device." >&2
  exit 64
fi

bulk_files=${BULK_FILES:-20000}
case "$bulk_files" in
  '' | *[!0-9]* | 0*)
    printf '%s\n' "BULK_FILES must be a whole number from 1 to 99999." >&2
    exit 64
    ;;
esac
if [ "$bulk_files" -gt 99999 ]; then
  printf '%s\n' "BULK_FILES must be a whole number from 1 to 99999." >&2
  exit 64
fi

adb_shell() {
  timeout --signal=TERM --kill-after=10 "${2:-60}" \
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

# Scan source: the contents match the remote scan/clean files byte for byte,
# except size-mismatch.txt. only-here.txt matches only the restricted remote
# file; local-only.txt has no remote counterpart.
scan=/sdcard/SyncScopeE2E/Scan
seed_scan_file() {
  adb_shell "printf '$2\\n' > $scan/$1"
  adb_shell "touch -d @1704067200 $scan/$1"
}
adb_shell "mkdir -p $scan/a"
adb_shell "mkdir -p $scan/b"
seed_scan_file exact.txt 'exact metadata fixture'
seed_scan_file a/reusable.jpg 'reusable duplicate payload'
seed_scan_file b/reusable.jpg 'reusable duplicate payload'
seed_scan_file é-decomposed.txt 'decomposed unicode metadata'
seed_scan_file size-mismatch.txt 'local size differs'
seed_scan_file local-only.txt 'only on the device'
seed_scan_file only-here.txt 'only in restricted'

# Bulk source: one adb shell loop, no per-file fork. Adding 1000 or 100000 and
# stripping the leading 1 zero-pads the directory and file numbers.
bulk=/sdcard/SyncScopeE2E/Bulk
adb_shell "rm -rf $bulk && i=0 && while [ \$i -lt 200 ]; do n=\$((i + 1000)); mkdir -p $bulk/d\${n#1}; i=\$((i + 1)); done && i=0 && while [ \$i -lt $bulk_files ]; do d=\$((i % 200 + 1000)); f=\$((i + 100000)); echo \"bulk \${f#1}\" > $bulk/d\${d#1}/f\${f#1}.txt; i=\$((i + 1)); done" 600

printf '%s\n' "Seeded SyncScopeE2E fixtures on primary storage and /storage/$uuid."
