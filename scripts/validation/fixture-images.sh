#!/bin/sh
# Tiny media fixtures shared by fixture-seed.sh (remote roots) and
# device-fixtures.sh (device sources), feature 005 research R13. Embedded as
# base64, so seeding needs no image or video tool.
#
# Sourced by the seeders. Run on its own, it checks or regenerates the
# embedded files (feature 009, T001):
#   fixture-images.sh --check       decodes every fixture, verifies its type
#                                   (and the MP4's codec and 2 s duration)
#                                   and lists it; needs no ffmpeg
#   fixture-images.sh --regenerate  rebuilds JPG_TREE and MP4_CLIP with
#                                   ffmpeg, rewrites them in this file, then
#                                   runs --check. Only this needs ffmpeg; the
#                                   output is checked in like the images
#
# SUNSET, BEACH, FOREST and HARBOR are 2x2 solid colours. TWIN is a 3x3
# uncompressed copy of the sunset colour: its byte length must differ from
# SUNSET, because matching compares name, size and mtime, and an equal size
# would make the GalleryTwin sunset.png SYNCED.
#
# Feature 009 (contracts/maestro-tree-preview.md › Fixtures): JPG_TREE is a
# 16x16 baseline JPEG, MP4_CLIP a 2 s, 64x64, 5 fps, H.264 (constrained
# baseline) MP4 with no audio, and PDF_DOC a one-page PDF. They make up the
# `tree` set, defined once by tree_fixture_files below.

# shellcheck disable=SC2034
PNG_SUNSET='iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR42mP4X6EBRAwQCgAwzgZ9IcqVbAAAAABJRU5ErkJggg=='
PNG_BEACH='iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR42mP4cGcaEDFAKABELgmJ9Q2bNAAAAABJRU5ErkJggg=='
PNG_FOREST='iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR42mOQyzMCIgYIBQAUhgL5tBE0HAAAAABJRU5ErkJggg=='
PNG_HARBOR='iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR42mMQMcoDIgYIBQASVgLROtrnvwAAAABJRU5ErkJggg=='
PNG_TWIN='iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAIAAADZSiLoAAAAKUlEQVR4AQEeAOH/AP94KP94KP94KAD/eCj/eCj/eCgA/3go/3go/3go4oYOmLVMTfgAAAAASUVORK5CYII='
JPG_TREE='/9j/4AAQSkZJRgABAgAAAQABAAD/2wBDAAgKCgsKCw0NDQ0NDRAPEBAQEBAQEBAQEBASEhIVFRUSEhIQEBISFBQVFRcXFxUVFRUXFxkZGR4eHBwjIyQrKzP/xABLAAEBAAAAAAAAAAAAAAAAAAAABAEBAAAAAAAAAAAAAAAAAAAABhABAAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAAP/AABEIABAAEAMBIgACEQADEQD/2gAMAwEAAhEDEQA/AIQDcXf/2Q=='
MP4_CLIP='AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMpbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAB9AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAnh0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAB9AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAEAAAABAAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAfQAAAAAAABAAAAAAHwbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAUABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABm21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAVtzdGJsAAAAu3N0c2QAAAAAAAAAAQAAAKthdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAQABIAAAASAAAAAAAAAABDExhdmMgbGlieDI2NAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAMWF2Y0MBQsAe/+EAGGdCwB6mERCbARAAAAMAEAAAAwCg8WLhGAEABmjIQgJSyAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAABdgAAAAAAAAABhzdHRzAAAAAAAAAAEAAAAKAAAIAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAAKAAAAAQAAADxzdHN6AAAAAAAAAAAAAAAKAAAEcgAAAB0AAAApAAAAMgAAACQAAAAzAAAAKwAAACYAAAAkAAAAIgAAABRzdGNvAAAAAAAAAAEAAANZAAAAPXVkdGEAAAA1bWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAIaWxzdAAAAAhmcmVlAAAF4G1kYXQAAAJxBgX//23cRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIyIGIzNTYwNWEgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MCByZWY9MTYgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MToweDEzMSBtZT11bWggc3VibWU9MTAgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0yNCBjaHJvbWFfbWU9MSB0cmVsbGlzPTIgOHg4ZGN0PTAgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0xIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MCB3ZWlnaHRwPTAga2V5aW50PTEwIGtleWludF9taW49MSBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTEwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MzUuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAflliIJ/8PkPoUAAr4oB4CLNiAj1wAWvPSyBnGP10CygQnIcQCUiAAGwMYE28Njv4aAEeSmH2YIQJKQWZg7XHKUPDSFAMuHvAA97qiCi8GAOEwGAYIAQAFKHEnYD74FjhluH7KWYA1fGmh8Q3h/w0UBxDOGlv4MQ2RIPeEgCHAAWEAoDaQQiSwDfKZAF55+/QDcymIE2ef58I4nTywA4EhLMDvB+KAB88YBLcmbgfAI+mvXxB0O2v2J38+vCAiyYEAAbAAehyPp882/OspcDQ5PnBgVG07JtH5YfD8LsACHVt6JN3/f/943T6zVySmwAZg/iJfph38OgMF1TuZzevxSP1iw4jwYAeUq6jfUgGy+2wrsFj/Vc1ppOhtmvd878If/4JGBwgVqDAK9kyGjh9Xv9M/qf//9ghwHBEJYmQCcojB72yny9gGPDBQDCAsPN+q4YBlmX8U2sMARBcMAIKHCz6H2mFxcYlgIj2WNOz4+BK4Bxar1wUjlqkQewMkOWYSAA3913QMIIA+LDBBx6LxRiMg0V+E4v2BB8ysQGyl/jtl/6MGG6ovEPxD1wLuFQv95YDmtwoAAgMCnhAAJqMJe2QQiSwrAX0wrFHUAjoEqpx8AzcsP1/eBUuC0KtSw8HTMBS1UwYJISAQdCimY+5sUcGd30RATfsxUuAAAAGUGaHPGoJQrMMWuglXQS4IxM9+GXwl/ULpsAAAAlQZoqPGpBFwRmJZM3fT6Jlp8MMf9fkvb+kTafCta5vNwCWLt/gAAAAC5BmjsXGrCEIwxJhL57a9j+Py0+isJc9aZNZv6wpwSGq9zWFOF83m8l/FurR9i/AAAAIEGaSQXFHe1hKE+X8dHx61hDYYYfZb5L8X7YjqLY6wl8AAAAL0GaWUJxpdsJQtwVwiQLz/H8+n2XkCUKQnwqT1y1hDLrCGg0SJ+J8UgBNR2d4ungAAAAJ0GaaYJxqwlCdc+sIaPl9Ofcu4SjuCWPR2v5DJNrCXOvNT6vl1GOqgAAACJBmnnDcUd+bpYShOew4YaPl68Jwmr1hLeXwlCkJ6OnPxe3AAAAIEGaiIBHGrHR/WEOG8Pst24Uy/OWJsvjoyNQ2s2sJdJ8AAAAHkGamJBnFXCNl8Kf1ApTWEPpwZfT9gvNe8l6FaP4vw=='
PDF_DOC='JVBERi0xLjEKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgNzIgNzJdPj5lbmRvYmoKdHJhaWxlcjw8L1Jvb3QgMSAwIFI+PgolJUVPRgo='

# The `tree` set (feature 009), the one definition both seeders write: the
# server side under <root>/scan/tree (TREE_FIXTURE_PATH), the device side in
# TREE_DEVICE_DIR. The device folder is not SyncScopeE2E/Scan/tree: shared
# storage is case-insensitive, so that would add the set to the Scan source,
# and "Tree" alone would collide with the Tree view choice. Hooks name a
# device file by its fixture path (scan/tree/<path>), mapped onto
# TREE_DEVICE_DIR/<path>. Every file gets TREE_MTIME on both sides, so all of
# them match by name, size and mtime.
TREE_FIXTURE_PATH=scan/tree
TREE_DEVICE_DIR=/sdcard/SyncScopeE2E/ScanTree
TREE_MTIME=1704067200
TREE_EMPTY_DIRS='Empty'

# tree_fixture_files prints one "<path> <fixture variable>" line per file of
# the tree set, relative to the set's root.
tree_fixture_files() {
  for name in a1 a2 a3 a4 a5; do
    printf 'Album/2024/%s.jpg JPG_TREE\n' "$name"
  done
  printf '%s\n' \
    'Album/2025/b1.jpg JPG_TREE' \
    'Album/2025/new.jpg JPG_TREE' \
    'Album/2025/clip.mp4 MP4_CLIP' \
    'Album/Docs/doc.pdf PDF_DOC' \
    'Loose.jpg JPG_TREE'
}

# write_fixture <base64> <path>: decodes one embedded fixture to a file.
write_fixture() {
  printf '%s' "$1" | base64 -d >"$2"
}

# write_png <base64> <path>: the name the feature 005 seeders use.
write_png() {
  write_fixture "$1" "$2"
}

# fixture_value <variable>: the base64 held by one fixture variable.
fixture_value() {
  eval "printf '%s' \"\${$1}\""
}

# _fixture_hex <file>: the file as one lowercase hex string.
_fixture_hex() {
  od -An -v -tx1 "$1" | tr -d ' \n'
}

# _fixture_check <variable> <expected kind>: decodes one fixture and prints
# "<variable> <kind> <bytes> bytes sha256 <digest>[ <details>]", or fails.
_fixture_check() {
  check_tmp=$(mktemp)
  if ! fixture_value "$1" | base64 -d >"$check_tmp" 2>/dev/null || [ ! -s "$check_tmp" ]; then
    rm -f "$check_tmp"
    printf '%s: not valid base64\n' "$1" >&2
    return 1
  fi
  hex=$(_fixture_hex "$check_tmp")
  bytes=$(wc -c <"$check_tmp" | tr -d ' ')
  digest=$(sha256sum "$check_tmp" | cut -c1-64)
  rm -f "$check_tmp"
  details=
  case "$2" in
    image/png)
      case "$hex" in 89504e470d0a1a0a*) ;; *) printf '%s: not a PNG\n' "$1" >&2; return 1 ;; esac
      ;;
    image/jpeg)
      case "$hex" in ffd8ff*ffd9) ;; *) printf '%s: not a JPEG\n' "$1" >&2; return 1 ;; esac
      ;;
    application/pdf)
      case "$hex" in 255044462d*) ;; *) printf '%s: not a PDF\n' "$1" >&2; return 1 ;; esac
      ;;
    video/mp4)
      # ftyp first, an H.264 sample entry (avc1 + avcC), and the movie
      # header's duration / timescale (mvhd version 0 or 1) equal to 2 s.
      case "$hex" in ????????66747970*) ;; *) printf '%s: not an MP4\n' "$1" >&2; return 1 ;; esac
      case "$hex" in *6176633100*61766343*) ;; *) printf '%s: not H.264\n' "$1" >&2; return 1 ;; esac
      millis=$(printf '%s\n' "$hex" | awk '
        function dec(h,   i, n) {
          n = 0
          for (i = 1; i <= length(h); i++) n = n * 16 + index("0123456789abcdef", substr(h, i, 1)) - 1
          return n
        }
        {
          s = $0; base = 0
          while ((i = index(s, "6d766864")) > 0) {
            at = base + i
            if ((at - 1) % 2 == 0) {
              body = substr($0, at + 8)
              if (substr(body, 1, 2) == "01") { scale = dec(substr(body, 41, 8)); length_ = dec(substr(body, 49, 16)) }
              else { scale = dec(substr(body, 25, 8)); length_ = dec(substr(body, 33, 8)) }
              if (scale > 0) { printf "%d\n", length_ * 1000 / scale; exit }
            }
            base = at; s = substr($0, at + 1)
          }
        }')
      [ "${millis:-0}" -eq 2000 ] || {
        printf '%s: duration is %s ms, not 2000 ms\n' "$1" "${millis:-unknown}" >&2
        return 1
      }
      details=' h264 2.000 s'
      ;;
  esac
  printf '%s %s %s bytes sha256 %s%s\n' "$1" "$2" "$bytes" "$digest" "$details"
}

fixture_images_check() {
  status=0
  for entry in PNG_SUNSET:image/png PNG_BEACH:image/png PNG_FOREST:image/png \
    PNG_HARBOR:image/png PNG_TWIN:image/png JPG_TREE:image/jpeg \
    MP4_CLIP:video/mp4 PDF_DOC:application/pdf; do
    _fixture_check "${entry%%:*}" "${entry#*:}" || status=1
  done
  return "$status"
}

# fixture_images_regenerate <this file>: rebuilds JPG_TREE and MP4_CLIP with
# ffmpeg (bit-exact flags, no metadata) and rewrites their lines in place.
fixture_images_regenerate() {
  command -v ffmpeg >/dev/null 2>&1 || {
    printf '%s\n' 'Regenerating the fixtures needs ffmpeg (DEVELOPMENT.md).' >&2
    return 69
  }
  work=$(mktemp -d)
  ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'color=c=0x3a7bd5:s=16x16:d=1' \
    -frames:v 1 -q:v 5 -map_metadata -1 -fflags +bitexact -flags:v +bitexact \
    "$work/tree.jpg" || { rm -rf "$work"; return 1; }
  ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'testsrc=size=64x64:rate=5:duration=2' \
    -c:v libx264 -profile:v baseline -level 3.0 -pix_fmt yuv420p -preset veryslow \
    -crf 35 -g 10 -x264-params threads=1 -an -map_metadata -1 \
    -fflags +bitexact -flags:v +bitexact -movflags +faststart \
    "$work/clip.mp4" || { rm -rf "$work"; return 1; }
  jpg=$(base64 -w0 "$work/tree.jpg")
  mp4=$(base64 -w0 "$work/clip.mp4")
  awk -v jpg="$jpg" -v mp4="$mp4" '
    /^JPG_TREE=/ { print "JPG_TREE='\''" jpg "'\''"; next }
    /^MP4_CLIP=/ { print "MP4_CLIP='\''" mp4 "'\''"; next }
    { print }' "$1" >"$work/script" || { rm -rf "$work"; return 1; }
  cat "$work/script" >"$1"
  rm -rf "$work"
}

case "${0##*/}" in
  fixture-images.sh)
    set -eu
    case "${1:-}" in
      --check)
        fixture_images_check
        ;;
      --regenerate)
        fixture_images_regenerate "$0"
        exec sh "$0" --check
        ;;
      *)
        printf '%s\n' 'Usage: fixture-images.sh --check | --regenerate' >&2
        exit 64
        ;;
    esac
    ;;
esac
