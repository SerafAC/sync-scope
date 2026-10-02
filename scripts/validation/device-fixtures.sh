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
# Feature 005 (research R13) adds SyncScopeE2E/Gallery (real PNGs, three of
# them byte-identical to the remote gallery/ root, plus local-only files),
# SyncScopeE2E/GalleryTwin (a sunset.png of a different size) and
# SyncScopeE2E/GalleryBulk, GALLERY_BULK_FILES copies of one PNG. The images
# come from fixture-images.sh, which fixture-seed.sh shares.
#
# Targets the device in ANDROID_SERIAL. Idempotent: directories use mkdir -p,
# fixture files are overwritten and the bulk tree is regenerated from scratch.
# Fails loudly when no public removable volume is mounted (R10: never skip
# removable-storage coverage).
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$here/android-sdk.sh"
. "$here/fixture-images.sh"
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

gallery_bulk_files=${GALLERY_BULK_FILES:-2000}
case "$gallery_bulk_files" in
  '' | *[!0-9]* | 0*)
    printf '%s\n' "GALLERY_BULK_FILES must be a whole number from 1 to 9999." >&2
    exit 64
    ;;
esac
if [ "$gallery_bulk_files" -gt 9999 ]; then
  printf '%s\n' "GALLERY_BULK_FILES must be a whole number from 1 to 9999." >&2
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

# Gallery sources: each image is pushed once from a temp file (adb push does
# not keep mtimes, so every file is touched afterwards).
gallery=/sdcard/SyncScopeE2E/Gallery
twin=/sdcard/SyncScopeE2E/GalleryTwin
png_tmp=$(mktemp)
trap 'rm -f "$png_tmp"' EXIT
push_png() {
  write_png "$1" "$png_tmp"
  timeout --signal=TERM --kill-after=10 60 \
    "$ANDROID_HOME/platform-tools/adb" -s "$serial" push "$png_tmp" "$2" >/dev/null
  adb_shell "touch -d @1704067200 $2"
}
adb_shell "mkdir -p $gallery/album"
adb_shell "mkdir -p $gallery/drafts"
adb_shell "mkdir -p $twin"
push_png "$PNG_SUNSET" "$gallery/sunset.png"
push_png "$PNG_BEACH" "$gallery/beach.png"
push_png "$PNG_FOREST" "$gallery/album/forest.png"
push_png "$PNG_HARBOR" "$gallery/harbor.png"
push_png "$PNG_TWIN" "$twin/sunset.png"
adb_shell "cp $gallery/harbor.png $gallery/drafts/draft.png"
adb_shell "touch -d @1704067200 $gallery/drafts/draft.png"
adb_shell "printf 'gallery notes\\n' > $gallery/album/notes.txt"
adb_shell "touch -d @1704067200 $gallery/album/notes.txt"

# GalleryBulk: one adb shell loop copying the pushed harbor.png. Adding 10000
# and stripping the leading 1 zero-pads the file numbers to g0000…g9999.
gallery_bulk=/sdcard/SyncScopeE2E/GalleryBulk
adb_shell "rm -rf $gallery_bulk && mkdir -p $gallery_bulk && i=0 && while [ \$i -lt $gallery_bulk_files ]; do f=\$((i + 10000)); cp $gallery/harbor.png $gallery_bulk/g\${f#1}.png; i=\$((i + 1)); done && touch -d @1704067200 $gallery_bulk/*.png" 600

printf '%s\n' "Seeded SyncScopeE2E fixtures on primary storage and /storage/$uuid."
