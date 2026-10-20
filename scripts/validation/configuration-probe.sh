#!/bin/sh
# Feature 008, T039/T040: the real-emulator configuration experiment for guest
# animation scales and debug scan pacing. Not a runner mode and not part of the
# workspace: android-flow.sh gets no option (same pattern as the T035
# field-selection probe, decision 2026-10-18 "Focused detached probe").
#
#   scripts/validation/configuration-probe.sh --out <dir> [--api 31] [--api 36]
#
# <dir> must be a new directory under validation/evidence/performance/
# configuration/ (private, ignored). For each API it boots the owned
# validation emulator through android-validator.sh (the legacy launch of
# normal validation), installs the one shared x86_64 debug APK, seeds the
# device fixtures once with device-fixtures.sh, and with the FTP, SFTP and
# WebDAV services and Metro started by the existing service scripts runs, with
# the pinned Maestro 2.10.0, three repetitions of four separate cohorts:
#   A  animations as found (1/1/1), pacing 4000 ms   H03 H05 H06 H07 H08
#   B  animations 0/0/0,            pacing 4000 ms   H03 H05 H06 H07 H08
#   C  animations as found,         pacing 1000 ms   the three clean scans
#   D  animations 0/0/0,            pacing 1000 ms   the three clean scans
# The cohort order alternates per repetition. Flows are unchanged except the
# SCAN_DELAY_MS value of the clean-scan flows in a private tree for C/D. Every
# result is kept, failed ones included; nothing is retried or replaced. The
# animation scales found at boot are restored before the emulator is released,
# also on failure. Only resources this probe acquired are released.
set -eu

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/android-sdk.sh"

repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
apis=
out=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --api)
      case "${2:-}" in 31|36) ;; *) exit 64 ;; esac
      case " $apis " in *" $2 "*) exit 64 ;; esac
      apis="$apis $2"
      shift 2
      ;;
    --out)
      [ -n "${2:-}" ] || exit 64
      out=$2
      shift 2
      ;;
    *) exit 64 ;;
  esac
done
[ -n "$apis" ] || apis=" 31 36"
case "$out" in
  "$repo"/validation/evidence/performance/configuration/*) ;;
  validation/evidence/performance/configuration/*) out="$repo/$out" ;;
  *) printf '%s\n' "--out must be under validation/evidence/performance/configuration/." >&2; exit 64 ;;
esac
case "$out" in */../*|*/./*|*/..|*/.) exit 64 ;; esac
[ ! -e "$out" ] || { printf '%s\n' "Refusing to reuse $out; every probe keeps its own results." >&2; exit 64; }

android_sdk_resolve
. "$repo/scripts/validation/validation-lifecycle.sh"
umask 077
mkdir -p "$(dirname -- "$out")"
mkdir -m 700 "$out"
mkdir -m 700 "$out/raw" "$out/trees"

invocation_lock=$(validation_state invocation.lock)
validation_lock_safe "$invocation_lock" || exit 1
exec 9>>"$invocation_lock"
flock -n 9 || { printf '%s\n' "Another validation invocation is active." >&2; exit 1; }
SYNCSCOPE_INVOCATION_TOKEN=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
export SYNCSCOPE_INVOCATION_TOKEN
claims=$(mktemp -d /tmp/cloud-sync-checker-claims-XXXXXX)
SYNCSCOPE_INVOCATION_MODE_FILE="$claims/invocation-mode"
printf '%s:e2e\n' "$SYNCSCOPE_INVOCATION_TOKEN" >"$SYNCSCOPE_INVOCATION_MODE_FILE"
export SYNCSCOPE_INVOCATION_MODE_FILE
unset SYNCSCOPE_GRAPHICS_PROFILE SYNCSCOPE_GRAPHICS_CANDIDATE SYNCSCOPE_GRAPHICS_PIN SYNCSCOPE_PERFORMANCE_DIR
validator_lock=$(validation_state validator.lock)
metro_state=$(validation_state metro)
compose="$repo/validation/services/compose.yaml"
maestro_bin=${SYNCSCOPE_MAESTRO_BIN:-"$HOME/.cache/cloud-sync-checker-toolchain/maestro-2.10.0/maestro/bin/maestro"}
adb_bin="$ANDROID_HOME/platform-tools/adb"
results="$out/runs.tsv"
scales='window_animation_scale transition_animation_scale animator_duration_scale'
gradle_pid=
maestro_pid=

# restore_animations <api>: puts back the scales found at boot (a missing
# setting is deleted again), when this probe recorded them.
restore_animations() {
  saved="$claims/animations-$1"
  [ -f "$saved" ] || return 0
  restore_serial=$(cat "$(validation_state "api$1")/serial" 2>/dev/null) || return 1
  while read -r name value; do
    if [ "$value" = null ]; then
      timeout 30 "$adb_bin" -s "$restore_serial" shell settings delete global "$name" </dev/null >/dev/null || return 1
    else
      timeout 30 "$adb_bin" -s "$restore_serial" shell settings put global "$name" "$value" </dev/null || return 1
    fi
  done <"$saved"
  rm -f -- "$saved"
}

cleanup() {
  status=$?
  trap - EXIT
  trap ':' HUP INT TERM
  if [ -n "$maestro_pid" ]; then
    validation_stop_process "$claims/maestro" || true
    wait "$maestro_pid" 2>/dev/null || true
  fi
  if [ -n "$gradle_pid" ]; then
    validation_stop_process "$claims/gradle" || true
    wait "$gradle_pid" 2>/dev/null || true
  fi
  case "$(validation_read_receipt "$claims/metro" 2>/dev/null || true)" in
    acquired)
      SYNCSCOPE_RESOURCE_RECEIPT="$claims/metro" "$repo/scripts/validation/metro-service.sh" stop \
        --host 127.0.0.1 --port 8081 --state "$metro_state" || { [ "$status" -ne 0 ] || status=1; }
      ;;
  esac
  for cleanup_api in $apis; do
    case "$(validation_read_receipt "$claims/emulator-$cleanup_api" 2>/dev/null || true)" in
      acquired|borrowed)
        restore_animations "$cleanup_api" || {
          printf '%s\n' "Could not restore the animation scales on API $cleanup_api." >&2
          [ "$status" -ne 0 ] || status=1
        }
        ;;
    esac
    case "$(validation_read_receipt "$claims/emulator-$cleanup_api" 2>/dev/null || true)" in
      acquired)
        SYNCSCOPE_RESOURCE_RECEIPT="$claims/emulator-$cleanup_api" "$repo/scripts/validation/android-validator.sh" stop \
          --api "$cleanup_api" --avd "dependency_api$cleanup_api" \
          --state "$(validation_state "api$cleanup_api")" \
          --exclusive-lock "$validator_lock" || { [ "$status" -ne 0 ] || status=1; }
        ;;
    esac
  done
  for protocol in sftp webdav ftp; do
    case "$(validation_read_receipt "$claims/$protocol" 2>/dev/null || true)" in
      acquired) service_action=stop ;;
      borrowed) service_action=audit ;;
      *) continue ;;
    esac
    # The FTP endpoint is approved only with its passive range, as at start.
    case "$protocol" in
      sftp) port=32122; passive= ;;
      webdav) port=32180; passive= ;;
      ftp) port=32120; passive='--passive-ports 32200-32209' ;;
    esac
    # shellcheck disable=SC2086
    SYNCSCOPE_RESOURCE_RECEIPT="$claims/$protocol" "$repo/scripts/validation/protocol-service.sh" "$service_action" "$protocol" \
      --compose "$compose" --project "syncscope-$protocol" --host 127.0.0.1 --port "$port" $passive ||
      { [ "$status" -ne 0 ] || status=1; }
  done
  rm -rf -- "$claims" || { [ "$status" -ne 0 ] || status=1; }
  if [ -f "$results" ]; then
    node "$repo/scripts/validation/configuration-probe.mjs" summarize "$out" "$status" ||
      { [ "$status" -ne 0 ] || status=1; }
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM

clock() { node "$repo/scripts/validation/performance-report.mjs" clock; }

# The private trees: the workspace as it is (pacing 4000 ms) and the same with
# 1000 ms in the three clean-scan flows. Each replacement must apply exactly once.
cp -R "$repo/validation/maestro" "$out/trees/pace-4000"
cp -R "$repo/validation/maestro" "$out/trees/pace-1000"
for protocol in ftp sftp webdav; do
  flow="$out/trees/pace-1000/scan/01-clean-scan-$protocol.yaml"
  [ "$(grep -c 'SCAN_DELAY_MS: "4000"' "$flow")" = 1 ] || { printf '%s\n' "Unexpected pacing in $flow." >&2; exit 1; }
  sed -i 's/SCAN_DELAY_MS: "4000"/SCAN_DELAY_MS: "1000"/' "$flow"
done
printf 'api\tcohort\tanimations\tpacingMs\tflow\trepetition\tstatus\tstartNs\tendNs\tartifact\n' >"$results"

gradle_log="$out/raw/build.log"
setsid timeout --signal=TERM --kill-after=20 1200 \
  "$repo/android/gradlew" -p "$repo/android" --no-daemon \
  -PreactNativeArchitectures=x86_64 \
  :app:assembleDebug >"$gradle_log" 2>&1 9>&- &
gradle_pid=$!
mkdir -p "$claims/gradle"
validation_save_pid "$gradle_pid" "$claims/gradle" 2>/dev/null || true
wait "$gradle_pid"
gradle_pid=
debug_apk="$repo/android/app/build/outputs/apk/debug/app-debug.apk"
sha256sum "$debug_apk" | cut -d' ' -f1 >"$out/apk.sha256"

for protocol in sftp webdav ftp; do
  case "$protocol" in
    sftp) port=32122; passive= ;;
    webdav) port=32180; passive= ;;
    ftp) port=32120; passive='--passive-ports 32200-32209' ;;
  esac
  # shellcheck disable=SC2086
  SYNCSCOPE_RESOURCE_RECEIPT="$claims/$protocol" "$repo/scripts/validation/protocol-service.sh" start "$protocol" \
    --compose "$compose" --project "syncscope-$protocol" \
    --host 127.0.0.1 --port "$port" $passive 9>&-
  case "$(validation_read_receipt "$claims/$protocol")" in acquired|borrowed) ;; *) exit 1 ;; esac
done
SYNCSCOPE_RESOURCE_RECEIPT="$claims/metro" "$repo/scripts/validation/metro-service.sh" start \
  --host 127.0.0.1 --port 8081 --state "$metro_state" 9>&-
case "$(validation_read_receipt "$claims/metro")" in acquired|borrowed) ;; *) exit 1 ;; esac

# Credentials and the scroll manifest as android-flow.sh passes them; values
# are only ever Maestro arguments, never printed.
set --
for protocol in ftp sftp webdav; do
  case "$protocol" in
    ftp) prefix=FTP; port=32120; remote_root=/ ;;
    sftp) prefix=SFTP; port=32122; remote_root=/srv/fixtures ;;
    webdav) prefix=WEBDAV; port=32180; remote_root=/webdav ;;
  esac
  credential_file="$(validation_state "syncscope-$protocol")/credentials"
  user=$(sed -n 's/^username=//p' "$credential_file")
  password=$(sed -n 's/^password=//p' "$credential_file")
  [ -n "$user" ] && [ -n "$password" ] || { printf 'Missing %s credentials.\n' "$protocol" >&2; exit 1; }
  set -- "$@" -e "${prefix}_HOST=10.0.2.2" -e "${prefix}_PORT=$port" \
    -e "${prefix}_USER=$user" -e "${prefix}_PASSWORD=$password" -e "${prefix}_ROOT=$remote_root"
done
user=
password=
scroll_manifest=$("$repo/scripts/validation/scroll-manifest.sh" print)
while IFS= read -r manifest_line; do
  [ -z "$manifest_line" ] || set -- "$@" -e "$manifest_line"
done <<EOF
$scroll_manifest
EOF

counter=0
# probe <cohort> <animations> <pacing> <flow> <repetition>
probe() {
  counter=$((counter + 1))
  artifact="$out/raw/run-$api-$counter"
  mkdir -m 700 "$artifact" "$artifact/output" "$artifact/debug"
  probe_start=$(clock)
  setsid timeout --signal=TERM --kill-after=10 900 \
    "$maestro_bin" test "$@" -e "API_LEVEL=$api" \
    "$out/trees/pace-$probe_pacing/$probe_flow" \
    --test-output-dir "$artifact/output" --debug-output "$artifact/debug" \
    >"$artifact/maestro.log" 2>&1 </dev/null 9>&- &
  maestro_pid=$!
  mkdir -p "$claims/maestro"
  validation_save_pid "$maestro_pid" "$claims/maestro" 2>/dev/null || true
  flow_status=0
  wait "$maestro_pid" || flow_status=$?
  maestro_pid=
  probe_end=$(clock)
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$api" "$probe_cohort" "$probe_animations" \
    "$probe_pacing" "$probe_flow" "$probe_repetition" "$flow_status" "$probe_start" "$probe_end" \
    "run-$api-$counter" >>"$results"
}

# set_animations <found|0>: applies the cohort's scales and records what the
# device reports afterwards.
set_animations() {
  for name in $scales; do
    if [ "$1" = 0 ]; then
      timeout 30 "$adb_bin" -s "$serial" shell settings put global "$name" 0
    else
      value=$(sed -n "s/^$name //p" "$found_scales")
      if [ "$value" = null ]; then
        timeout 30 "$adb_bin" -s "$serial" shell settings delete global "$name" >/dev/null
      else
        timeout 30 "$adb_bin" -s "$serial" shell settings put global "$name" "$value"
      fi
    fi
  done
  probe_animations=$(for name in $scales; do
    timeout 30 "$adb_bin" -s "$serial" shell settings get global "$name" | tr -d '\r'
  done | paste -sd/ -)
}

run_cohort() {
  probe_cohort=$1
  probe_pacing=$3
  set_animations "$2"
  shift 3
  if [ "$probe_pacing" = 4000 ]; then
    cohort_flows='sources/01-add-internal.yaml scan/01-clean-scan-ftp.yaml scan/05-background-discards.yaml browse/01-gallery-thousands.yaml polish/03-fast-scroll.yaml'
  else
    cohort_flows='scan/01-clean-scan-ftp.yaml scan/01-clean-scan-sftp.yaml scan/01-clean-scan-webdav.yaml'
  fi
  for probe_flow in $cohort_flows; do
    probe "$@"
  done
}

for api in $apis; do
  SYNCSCOPE_RESOURCE_RECEIPT="$claims/emulator-$api" "$repo/scripts/validation/android-validator.sh" start \
    --api "$api" --avd "dependency_api$api" \
    --state "$(validation_state "api$api")" \
    --exclusive-lock "$validator_lock" 6<&9 9>&-
  case "$(validation_read_receipt "$claims/emulator-$api")" in acquired|borrowed) ;; *) exit 1 ;; esac
  serial=$(cat "$(validation_state "api$api")/serial")
  export ANDROID_SERIAL="$serial"
  found_scales="$claims/animations-$api"
  for name in $scales; do
    printf '%s %s\n' "$name" "$(timeout 30 "$adb_bin" -s "$serial" shell settings get global "$name" | tr -d '\r')"
  done >"$found_scales"
  cp "$found_scales" "$out/animations-found-$api.txt"
  if ! installed=$(timeout --signal=TERM --kill-after=10 60 "$adb_bin" -s "$serial" install -r "$debug_apk" 2>&1); then
    case "$installed" in
      *INSTALL_FAILED_UPDATE_INCOMPATIBLE*)
        timeout --signal=TERM --kill-after=10 60 "$adb_bin" -s "$serial" uninstall com.syncscope >/dev/null
        timeout --signal=TERM --kill-after=10 60 "$adb_bin" -s "$serial" install "$debug_apk"
        ;;
      *) printf '%s\n' "$installed" >&2; exit 1 ;;
    esac
  fi
  # T043: validation cost against regeneration. The completion markers (outside
  # every scanned tree) are removed first, so the first pass regenerates every
  # immutable set and the second, on the same untouched trees, only validates.
  timeout 30 "$adb_bin" -s "$serial" shell rm -rf /data/local/tmp/syncscope-fixtures </dev/null
  for fixture_pass in reseed validate; do
    fixtures_start=$(clock)
    "$repo/scripts/validation/device-fixtures.sh" </dev/null >"$out/raw/fixtures-$api-$fixture_pass.log" 2>&1
    printf '%s\t%s\t%s\t%s\n' "$api" "$fixture_pass" "$fixtures_start" "$(clock)" >>"$out/fixtures.tsv"
  done

  for repetition in 1 2 3; do
    probe_repetition=$repetition
    if [ "$repetition" = 2 ]; then
      run_cohort B 0 4000 "$@"; run_cohort A found 4000 "$@"
      run_cohort D 0 1000 "$@"; run_cohort C found 1000 "$@"
    else
      run_cohort A found 4000 "$@"; run_cohort B 0 4000 "$@"
      run_cohort C found 1000 "$@"; run_cohort D 0 1000 "$@"
    fi
  done

  restore_animations "$api"
  if [ "$(validation_read_receipt "$claims/emulator-$api")" = acquired ]; then
    SYNCSCOPE_RESOURCE_RECEIPT="$claims/emulator-$api" "$repo/scripts/validation/android-validator.sh" stop \
      --api "$api" --avd "dependency_api$api" \
      --state "$(validation_state "api$api")" \
      --exclusive-lock "$validator_lock"
  fi
done
