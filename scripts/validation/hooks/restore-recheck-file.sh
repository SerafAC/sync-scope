#!/bin/sh
# Undoes remove-recheck-file.sh: puts one removed file back in the host
# fixture tree and resets its directory's mtime, so the tree matches what
# fixture-seed.sh wrote. The protocol services compare that tree with their
# before-manifest when they stop, and the next API level runs the staged
# lines against the same tree.
#
# Usage: restore-recheck-file.sh [<fixture path> [<source path>]]
#   With no argument: copies gallery/beach.png back to recheck/beach.png
#   (flow 06, feature 006).
#   <fixture path>: the file to restore, relative to the fixture root, for
#   example scan/tree/Album/2025/new.jpg (feature 009).
#   <source path>: the copy to restore it from, relative to the fixture root.
#   Omitted, a file of the tree set (scan/tree/...) is rewritten from its
#   definition in fixture-images.sh with the set's mtime; any other path
#   needs a source.
#   Neither path may start with "/" or contain "..".
# A no-op when the file is present, or when its directory is absent.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$here/../fixture-images.sh"

state=${SYNCSCOPE_STATE_ROOT:-}
case "$state" in
  /tmp/cloud-sync-checker-*) ;;
  *)
    printf '%s\n' "SYNCSCOPE_STATE_ROOT must name owned SyncScope scratch." >&2
    exit 64
    ;;
esac

[ "$#" -le 2 ] || {
  printf '%s\n' "Usage: restore-recheck-file.sh [<fixture path> [<source path>]]" >&2
  exit 64
}
if [ "$#" -eq 0 ]; then
  path=recheck/beach.png
  source=gallery/beach.png
else
  path=$1
  source=${2-}
fi
for checked in "$path" ${2+"$source"}; do
  case "$checked" in
    '' | /* | *..*)
      printf 'Fixture path must be relative and stay in the fixture tree: %s\n' "$checked" >&2
      exit 64
      ;;
  esac
done

# The tree set's definition, when no source is given.
variable=
if [ -z "$source" ]; then
  case "$path" in
    "$TREE_FIXTURE_PATH"/*)
      relative=${path#"$TREE_FIXTURE_PATH"/}
      variable=$(tree_fixture_files | awk -v p="$relative" '$1 == p { print $2 }')
      ;;
  esac
  [ -n "$variable" ] || {
    printf 'No source for %s: name one, or a file of the %s set.\n' "$path" "$TREE_FIXTURE_PATH" >&2
    exit 64
  }
fi

target="$state/fixtures/$path"
directory=$(dirname -- "$target")
[ -d "$directory" ] || exit 0
[ ! -e "$target" ] || exit 0
if [ -n "$source" ]; then
  cp -p -- "$state/fixtures/$source" "$target"
else
  (umask 022 && write_fixture "$(fixture_value "$variable")" "$target")
  touch -d "@$TREE_MTIME.000000000" "$target"
fi
touch -d '@1704067200.000000000' "$directory"
