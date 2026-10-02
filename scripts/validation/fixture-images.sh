# Tiny PNG fixtures shared by fixture-seed.sh (remote gallery roots) and
# device-fixtures.sh (device Gallery sources), feature 005 research R13.
# Sourced, never run. Embedded as base64 so no image tool is needed.
#
# SUNSET, BEACH, FOREST and HARBOR are 2x2 solid colours. TWIN is a 3x3
# uncompressed copy of the sunset colour: its byte length must differ from
# SUNSET, because matching compares name, size and mtime, and an equal size
# would make the GalleryTwin sunset.png SYNCED.

# shellcheck disable=SC2034
PNG_SUNSET='iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR42mP4X6EBRAwQCgAwzgZ9IcqVbAAAAABJRU5ErkJggg=='
PNG_BEACH='iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR42mP4cGcaEDFAKABELgmJ9Q2bNAAAAABJRU5ErkJggg=='
PNG_FOREST='iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR42mOQyzMCIgYIBQAUhgL5tBE0HAAAAABJRU5ErkJggg=='
PNG_HARBOR='iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR42mMQMcoDIgYIBQASVgLROtrnvwAAAABJRU5ErkJggg=='
PNG_TWIN='iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAIAAADZSiLoAAAAKUlEQVR4AQEeAOH/AP94KP94KP94KAD/eCj/eCj/eCgA/3go/3go/3go4oYOmLVMTfgAAAAASUVORK5CYII='

# write_png <base64> <path>: decodes one embedded image to a file.
write_png() {
  printf '%s' "$1" | base64 -d >"$2"
}
