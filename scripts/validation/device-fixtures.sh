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
# Feature 006 adds SyncScopeE2E/Delete, Recheck, Offline, Select and Changed,
# each the same tree as Gallery (seed_gallery_tree), for the selection and
# deletion flows. Those flows delete or change device files, so every gallery
# tree is removed and re-created on each run.
#
# Feature 007 (contracts/maestro-polish.md › Fixtures) adds
# SyncScopeE2E/TwoFolders, a copy of Scan/a and Scan/b plus the two b-only-*
# files (the device side of the remote scan/clean/a and scan/clean/b folders);
# SyncScopeE2E/Scroll and
# SyncScopeE2E/Narrow, generated from the scroll_* and narrow_* functions of
# scroll-manifest.sh (padded PNGs, so every file is still a valid image); and
# DCIM/Big, 10,000 empty .jpg files for the picker spike and flow 08.
#
# Feature 008 (T043, research R9, data-model fixture states): the immutable
# sets Bulk, GalleryBulk, Narrow, Scroll and DCIM/Big are reused only after
# validation, never on file count alone. Each set's completion marker (in
# /data/local/tmp/syncscope-fixtures, outside every scanned tree) records a
# fingerprint of its generator (these scripts) and parameters (its file
# count) and a digest of the tree taken right after a successful seed:
# directory paths, file paths and sizes, required mtimes (GalleryBulk,
# Narrow, Scroll) and the SHA-256 of every file's content. A set is
# unknown -> validating -> valid (kept) or reseeded; the marker is removed
# before a reseed and written only after it succeeded (seeding -> valid), so
# a failed seed always reseeds next time. Every mutable tree (Scan,
# TwoFolders, Gallery, GalleryTwin, Delete, Recheck, Offline, Select,
# Changed) is still re-created on every run.
#
# Feature 009 (T002, contracts/maestro-tree-preview.md › Fixtures) adds the
# immutable `tree` set in SyncScopeE2E/ScanTree, the device side of the remote
# scan/tree (fixture-images.sh defines both): Album/2024/a1-a5.jpg,
# Album/2025/b1.jpg, new.jpg and clip.mp4, Album/Docs/doc.pdf, an empty
# Empty/ and Loose.jpg, all with one fixed mtime. It is reused while it
# validates (mtimes included); the workspace flow tree/05 deletes a1-a3 and
# staged/10 touches a4, so a changed set is reseeded before the next API
# level's workspace flows (this script runs once per API level, before them).
#
# Targets the device in ANDROID_SERIAL. Idempotent: directories use mkdir -p,
# fixture files are overwritten, the mutable trees are regenerated from
# scratch and an immutable set is kept only when it validates.
# Fails loudly when no public removable volume is mounted (R10: never skip
# removable-storage coverage).
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$here/android-sdk.sh"
. "$here/fixture-images.sh"
. "$here/scroll-manifest.sh"
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

# Immutable-set reuse (T043). The generator fingerprint covers every script
# that defines a set's names, sizes, mtimes or bytes.
marker_dir=/data/local/tmp/syncscope-fixtures
generator=$(cat "$here/device-fixtures.sh" "$here/fixture-images.sh" "$here/scroll-manifest.sh" |
  sha256sum | cut -c1-64)

# set_digest <dir> <mtime|-> prints the digest of the tree in <dir> (empty
# when it cannot be read): sorted directory paths, any other entry type
# (symlinks, specials) by path, file paths with sizes (and mtimes for
# `mtime`), and per-file content digests (the kind/path/size/content
# semantics of fixture-manifest.mjs, on the device).
set_digest() {
  case "$2" in mtime) stat_format='%s %Y %n' ;; *) stat_format='%s %n' ;; esac
  adb_shell "cd '$1' && { find . -type d | sort; find . ! -type d ! -type f | sed 's/^/other /' | sort; find . -type f -exec stat -c '$stat_format' {} + | sort; find . -type f -exec sha256sum {} + | sort -k 2; } | sha256sum" 900 |
    tr -d '\r' | cut -c1-64
}

# immutable_set <name> <dir> <parameters> <mtime|-> <seed function>: keeps
# <dir> when its marker matches the current fingerprint and the tree still
# has the recorded digest; otherwise removes the marker, seeds and records the
# new digest only after the seed succeeded.
immutable_set() {
  set_name=$1
  set_dir=$2
  fingerprint=$(printf '%s %s %s %s\n' "$generator" "$1" "$2" "$3" | sha256sum | cut -c1-64)
  marker=$(adb_shell "cat $marker_dir/$set_name 2>/dev/null || true" | tr -d '\r')
  recorded_fingerprint=$(printf '%s\n' "$marker" | sed -n 1p)
  recorded_digest=$(printf '%s\n' "$marker" | sed -n 2p)
  if [ -n "$recorded_digest" ] && [ "$recorded_fingerprint" = "$fingerprint" ]; then
    current=$(set_digest "$set_dir" "$4") || current=
    if [ "$current" = "$recorded_digest" ]; then
      printf '%s\n' "Keeping $set_dir (validated $set_name)."
      return 0
    fi
  fi
  printf '%s\n' "Seeding $set_dir ($set_name)."
  adb_shell "rm -f $marker_dir/$set_name"
  "$5"
  current=$(set_digest "$set_dir" "$4")
  [ -n "$current" ] || { printf '%s\n' "Cannot read $set_dir after seeding." >&2; exit 1; }
  adb_shell "mkdir -p $marker_dir && printf '%s\\n%s\\n' $fingerprint $current > $marker_dir/$set_name"
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

# TwoFolders (feature 007): the two remote folders scan/clean/a and
# scan/clean/b as one device source. Copies the Scan/a and Scan/b files above
# with their mtimes, so the tree is defined once (seed_scan_file).
two_folders=/sdcard/SyncScopeE2E/TwoFolders
adb_shell "rm -rf $two_folders && mkdir -p $two_folders && cp -Rp $scan/a $scan/b $two_folders/"
# The two files only the remote scan/clean/b holds (fixture-seed.sh): the
# second remote folder alone backs them up.
seed_two_folders_file() {
  adb_shell "printf '$2\\n' > $two_folders/$1"
  adb_shell "touch -d @1704067200 $two_folders/$1"
}
seed_two_folders_file b/b-only-deleted.jpg 'only in folder b, deleted by flow 04'
seed_two_folders_file b/b-only-kept.jpg 'only in folder b, kept by flow 04'

# Bulk source: one adb shell loop, no per-file fork. Adding 1000 or 100000 and
# stripping the leading 1 zero-pads the directory and file numbers.
bulk=/sdcard/SyncScopeE2E/Bulk
seed_bulk() {
  adb_shell "rm -rf $bulk && i=0 && while [ \$i -lt 200 ]; do n=\$((i + 1000)); mkdir -p $bulk/d\${n#1}; i=\$((i + 1)); done && i=0 && while [ \$i -lt $bulk_files ]; do d=\$((i % 200 + 1000)); f=\$((i + 100000)); echo \"bulk \${f#1}\" > $bulk/d\${d#1}/f\${f#1}.txt; i=\$((i + 1)); done" 600
}
immutable_set Bulk "$bulk" "files=$bulk_files" - seed_bulk

# Gallery sources: images are pushed from a temp file (adb push does not keep
# mtimes, so every file is touched afterwards).
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

# seed_gallery_tree <dir>: the one definition of the gallery tree. Removes
# and re-creates <dir>, so files a previous run deleted come back.
seed_gallery_tree() {
  tree=$1
  adb_shell "rm -rf $tree"
  adb_shell "mkdir -p $tree/album"
  adb_shell "mkdir -p $tree/drafts"
  push_png "$PNG_SUNSET" "$tree/sunset.png"
  push_png "$PNG_BEACH" "$tree/beach.png"
  push_png "$PNG_FOREST" "$tree/album/forest.png"
  push_png "$PNG_HARBOR" "$tree/harbor.png"
  adb_shell "cp $tree/harbor.png $tree/drafts/draft.png"
  adb_shell "touch -d @1704067200 $tree/drafts/draft.png"
  adb_shell "printf 'gallery notes\\n' > $tree/album/notes.txt"
  adb_shell "touch -d @1704067200 $tree/album/notes.txt"
}

for name in Gallery Delete Recheck Offline Select Changed; do
  seed_gallery_tree "/sdcard/SyncScopeE2E/$name"
done
adb_shell "mkdir -p $twin"
push_png "$PNG_TWIN" "$twin/sunset.png"

# The tree set (feature 009): one push per file from tree_fixture_files, then
# one touch for the whole set. Every adb call reads /dev/null, because adb
# shell forwards stdin and would drain the list.
tree_set=$TREE_DEVICE_DIR
tree_files=$(tree_fixture_files | wc -l | tr -d ' ')
seed_tree() {
  adb_shell "rm -rf $tree_set && mkdir -p $tree_set/Album/2024 $tree_set/Album/2025 $tree_set/Album/Docs $tree_set/$TREE_EMPTY_DIRS" </dev/null
  tree_fixture_files | while read -r tree_path tree_variable; do
    write_fixture "$(fixture_value "$tree_variable")" "$png_tmp"
    timeout --signal=TERM --kill-after=10 60 \
      "$ANDROID_HOME/platform-tools/adb" -s "$serial" push "$png_tmp" "$tree_set/$tree_path" >/dev/null </dev/null
  done
  adb_shell "cd $tree_set && find . -type f -exec touch -d @$TREE_MTIME {} +" </dev/null
}
immutable_set Tree "$tree_set" "files=$tree_files" mtime seed_tree

# GalleryBulk: one adb shell loop copying the pushed harbor.png. Adding 10000
# and stripping the leading 1 zero-pads the file numbers to g0000…g9999.
gallery_bulk=/sdcard/SyncScopeE2E/GalleryBulk
seed_gallery_bulk() {
  adb_shell "rm -rf $gallery_bulk && mkdir -p $gallery_bulk && i=0 && while [ \$i -lt $gallery_bulk_files ]; do f=\$((i + 10000)); cp $gallery/harbor.png $gallery_bulk/g\${f#1}.png; i=\$((i + 1)); done && touch -d @1704067200 $gallery_bulk/*.png" 600
}
immutable_set GalleryBulk "$gallery_bulk" "files=$gallery_bulk_files" mtime seed_gallery_bulk

# seed_generated <dir> <scroll|narrow> <count>: re-creates <dir> with the
# <count> files the manifest functions describe. One script is written on the
# host and run by one adb shell: each file is the base PNG, padded with zero
# bytes to its size (truncate) and given its mtime.
generated_base=/data/local/tmp/syncscope-generated-base.png
script_tmp=$(mktemp)
trap 'rm -f "$png_tmp" "$script_tmp"' EXIT
seed_generated() {
  dir=$1
  kind=$2
  count=$3
  generated_script=/data/local/tmp/syncscope-$kind.sh
  {
    printf 'set -e\n'
    printf "rm -rf '%s'\n" "$dir"
    printf "mkdir -p '%s'\n" "$dir"
    i=0
    while [ "$i" -lt "$count" ]; do
      "_$kind" "$i"
      printf "cp %s '%s/%s'; truncate -s %s '%s/%s'; touch -d @%s '%s/%s'\n" \
        "$generated_base" "$dir" "$_name" "$_size" "$dir" "$_name" \
        "$_mtime" "$dir" "$_name"
      i=$((i + 1))
    done
    printf 'rm -f %s %s\n' "$generated_base" "$generated_script"
  } >"$script_tmp"
  write_png "$PNG_SUNSET" "$png_tmp"
  timeout --signal=TERM --kill-after=10 60 \
    "$ANDROID_HOME/platform-tools/adb" -s "$serial" push "$png_tmp" "$generated_base" >/dev/null
  timeout --signal=TERM --kill-after=10 60 \
    "$ANDROID_HOME/platform-tools/adb" -s "$serial" push "$script_tmp" "$generated_script" >/dev/null
  adb_shell "sh $generated_script" 900
}

scroll=/sdcard/SyncScopeE2E/Scroll
narrow=/sdcard/SyncScopeE2E/Narrow
seed_scroll() { seed_generated "$scroll" scroll "$SCROLL_COUNT"; }
seed_narrow() { seed_generated "$narrow" narrow "$NARROW_COUNT"; }
immutable_set Scroll "$scroll" "files=$SCROLL_COUNT" mtime seed_scroll
immutable_set Narrow "$narrow" "files=$NARROW_COUNT" mtime seed_narrow

# DCIM/Big: 10,000 empty files in one adb shell loop (the picker spike, R15).
big=/sdcard/DCIM/Big
big_files=10000
seed_big() {
  adb_shell "rm -rf $big && mkdir -p $big && for i in \$(seq 1 $big_files); do : > $big/IMG_\$i.jpg; done" 600
}
immutable_set Big "$big" "files=$big_files" - seed_big

printf '%s\n' "Seeded SyncScopeE2E fixtures on primary storage and /storage/$uuid."
