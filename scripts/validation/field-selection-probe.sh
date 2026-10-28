#!/bin/sh
# Feature 008, T035 (decision 2026-10-18, "Focused detached probe"): the
# real-emulator compatibility and timing probe for field replacement. Not a
# runner mode and not part of the workspace: android-flow.sh gets no option.
#
#   scripts/validation/field-selection-probe.sh --out <dir> [--api 31] [--api 36]
#     [--candidate-only]
#
# <dir> must be a new directory under validation/evidence/performance/
# field-selection/ (private, ignored). For each API it boots the owned
# validation emulator through android-validator.sh (the legacy launch of
# normal validation), installs the one shared x86_64 debug APK, with Metro
# and the SFTP service started by the existing service scripts, and runs with
# the pinned Maestro 2.10.0:
#   1. the diagnostic flows in validation/probes/field-selection/ (d*.yaml):
#      each passes or fails as the answer to one compatibility question;
#   2. the T034 regression performance/01-field-replacement.yaml three times
#      against the original helper (validation/probes/field-selection/
#      original-fill-field.yaml, retained from before T036) and three times
#      against the workspace helper (the candidate T036 adopts),
#      alternating, each from a private copy of validation/maestro.
# --candidate-only (decision 2026-10-19, "Fix + short rerun") skips step 1 and
# the original-helper runs of step 2: only the candidate regression runs, three
# times per API.
# Every flow result is kept, failed ones included; nothing is retried or
# replaced. field-selection-probe.mjs then writes results.json and summary.md
# (helper durations by field name only, never typed values or credentials).
# Only resources this probe acquired are released; borrowed ones are kept.
set -eu

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/android-sdk.sh"

repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
apis=
out=
candidate_only=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --api)
      case "${2:-}" in 31|36) ;; *) exit 64 ;; esac
      case " $apis " in *" $2 "*) exit 64 ;; esac
      apis="$apis $2"
      shift 2
      ;;
    --candidate-only)
      [ -z "$candidate_only" ] || exit 64
      candidate_only=1
      shift
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
  "$repo"/validation/evidence/performance/field-selection/*) ;;
  validation/evidence/performance/field-selection/*) out="$repo/$out" ;;
  *) printf '%s\n' "--out must be under validation/evidence/performance/field-selection/." >&2; exit 64 ;;
esac
case "$out" in */../*|*/./*|*/..|*/.) exit 64 ;; esac
[ ! -e "$out" ] || { printf '%s\n' "Refusing to reuse $out; every probe keeps its own results." >&2; exit 64; }

android_sdk_resolve
. "$repo/scripts/validation/validation-lifecycle.sh"
mkdir -p "$(dirname -- "$out")"
mkdir -m 700 "$out"
mkdir -m 700 "$out/raw" "$out/trees"

# The same invocation lock as android-flow.sh: never two validation owners.
invocation_lock=$(validation_state invocation.lock)
validation_lock_safe "$invocation_lock" || exit 1
exec 9>>"$invocation_lock"
flock -n 9 || { printf '%s\n' "Another validation invocation is active." >&2; exit 1; }
SYNCSCOPE_INVOCATION_TOKEN=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
export SYNCSCOPE_INVOCATION_TOKEN
claims=$(mktemp -d /tmp/cloud-sync-checker-claims-XXXXXX)
# The validator accepts only the runner's modes; the probe is an ordinary
# (e2e-lifetime) owned emulator, never a measurement-cap one.
SYNCSCOPE_INVOCATION_MODE_FILE="$claims/invocation-mode"
printf '%s:e2e\n' "$SYNCSCOPE_INVOCATION_TOKEN" >"$SYNCSCOPE_INVOCATION_MODE_FILE"
export SYNCSCOPE_INVOCATION_MODE_FILE
unset SYNCSCOPE_GRAPHICS_PROFILE SYNCSCOPE_GRAPHICS_CANDIDATE SYNCSCOPE_GRAPHICS_PIN SYNCSCOPE_PERFORMANCE_DIR
validator_lock=$(validation_state validator.lock)
metro_state=$(validation_state metro)
compose="$repo/validation/services/compose.yaml"
maestro_bin=${SYNCSCOPE_MAESTRO_BIN:-"$HOME/.cache/cloud-sync-checker-toolchain/maestro-2.10.0/maestro/bin/maestro"}
probes="$repo/validation/probes/field-selection"
results="$out/runs.tsv"
gradle_pid=
maestro_pid=
serial=

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
      acquired)
        SYNCSCOPE_RESOURCE_RECEIPT="$claims/emulator-$cleanup_api" "$repo/scripts/validation/android-validator.sh" stop \
          --api "$cleanup_api" --avd "dependency_api$cleanup_api" \
          --state "$(validation_state "api$cleanup_api")" \
          --exclusive-lock "$validator_lock" || { [ "$status" -ne 0 ] || status=1; }
        ;;
    esac
  done
  case "$(validation_read_receipt "$claims/sftp" 2>/dev/null || true)" in
    acquired) service_action=stop ;;
    borrowed) service_action=audit ;;
    *) service_action= ;;
  esac
  if [ -n "$service_action" ]; then
    SYNCSCOPE_RESOURCE_RECEIPT="$claims/sftp" "$repo/scripts/validation/protocol-service.sh" "$service_action" sftp \
      --compose "$compose" --project syncscope-sftp --host 127.0.0.1 --port 32122 ||
      { [ "$status" -ne 0 ] || status=1; }
  fi
  rm -rf -- "$claims" || { [ "$status" -ne 0 ] || status=1; }
  if [ -f "$results" ]; then
    node "$repo/scripts/validation/field-selection-probe.mjs" summarize "$out" "$status" ||
      { [ "$status" -ne 0 ] || status=1; }
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM

clock() { node "$repo/scripts/validation/performance-report.mjs" clock; }

# The private trees: the workspace as it is (candidate), and the same with the
# retained original helper in place of subflows/fill-field.yaml.
# helper in place of subflows/fill-field.yaml.
cp -R "$repo/validation/maestro" "$out/trees/original"
cp -R "$repo/validation/maestro" "$out/trees/candidate"
cp "$probes/original-fill-field.yaml" "$out/trees/original/subflows/fill-field.yaml"
printf 'api\tkind\tflow\ttree\trepetition\tstatus\tstartNs\tendNs\tartifact\n' >"$results"

# One shared emulator-only debug build, as android-flow.sh e2e builds it.
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

SYNCSCOPE_RESOURCE_RECEIPT="$claims/sftp" "$repo/scripts/validation/protocol-service.sh" start sftp \
  --compose "$compose" --project syncscope-sftp --host 127.0.0.1 --port 32122 9>&-
case "$(validation_read_receipt "$claims/sftp")" in acquired|borrowed) ;; *) exit 1 ;; esac
SYNCSCOPE_RESOURCE_RECEIPT="$claims/metro" "$repo/scripts/validation/metro-service.sh" start \
  --host 127.0.0.1 --port 8081 --state "$metro_state" 9>&-
case "$(validation_read_receipt "$claims/metro")" in acquired|borrowed) ;; *) exit 1 ;; esac

credential_file="$(validation_state syncscope-sftp)/credentials"
sftp_user=$(sed -n 's/^username=//p' "$credential_file")
sftp_password=$(sed -n 's/^password=//p' "$credential_file")
[ -n "$sftp_user" ] && [ -n "$sftp_password" ] || { printf '%s\n' "Missing SFTP credentials." >&2; exit 1; }

counter=0
# probe <kind> <flow path> <tree label> <repetition>: one Maestro run, kept
# whatever its result; credentials are passed as -e arguments only.
probe() {
  counter=$((counter + 1))
  artifact="$out/raw/run-$api-$counter"
  mkdir -m 700 "$artifact" "$artifact/output" "$artifact/debug"
  # Not `start`/`end`: validation_save_pid assigns `start` (clock ticks).
  probe_start=$(clock)
  setsid timeout --signal=TERM --kill-after=10 900 \
    "$maestro_bin" test \
    -e SFTP_HOST=10.0.2.2 -e SFTP_PORT=32122 -e "SFTP_USER=$sftp_user" \
    -e "SFTP_PASSWORD=$sftp_password" -e SFTP_ROOT=/srv/fixtures -e "API_LEVEL=$api" \
    "$2" --test-output-dir "$artifact/output" --debug-output "$artifact/debug" \
    >"$artifact/maestro.log" 2>&1 </dev/null 9>&- &
  maestro_pid=$!
  mkdir -p "$claims/maestro"
  validation_save_pid "$maestro_pid" "$claims/maestro" 2>/dev/null || true
  flow_status=0
  wait "$maestro_pid" || flow_status=$?
  maestro_pid=
  probe_end=$(clock)
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$api" "$1" "${2##*/}" "$3" "$4" \
    "$flow_status" "$probe_start" "$probe_end" "run-$api-$counter" >>"$results"
}

for api in $apis; do
  SYNCSCOPE_RESOURCE_RECEIPT="$claims/emulator-$api" "$repo/scripts/validation/android-validator.sh" start \
    --api "$api" --avd "dependency_api$api" \
    --state "$(validation_state "api$api")" \
    --exclusive-lock "$validator_lock" 6<&9 9>&-
  case "$(validation_read_receipt "$claims/emulator-$api")" in acquired|borrowed) ;; *) exit 1 ;; esac
  serial=$(cat "$(validation_state "api$api")/serial")
  export ANDROID_SERIAL="$serial"
  if ! installed=$(timeout --signal=TERM --kill-after=10 60 \
    "$ANDROID_HOME/platform-tools/adb" -s "$serial" install -r "$debug_apk" 2>&1); then
    case "$installed" in
      *INSTALL_FAILED_UPDATE_INCOMPATIBLE*)
        timeout --signal=TERM --kill-after=10 60 "$ANDROID_HOME/platform-tools/adb" -s "$serial" uninstall com.syncscope >/dev/null
        timeout --signal=TERM --kill-after=10 60 "$ANDROID_HOME/platform-tools/adb" -s "$serial" install "$debug_apk"
        ;;
      *) printf '%s\n' "$installed" >&2; exit 1 ;;
    esac
  fi

  if [ -z "$candidate_only" ]; then
    for flow in "$probes"/d*.yaml; do
      probe diagnostic "$flow" - 1
    done
  fi
  for repetition in 1 2 3; do
    if [ -z "$candidate_only" ]; then
      probe regression "$out/trees/original/performance/01-field-replacement.yaml" original "$repetition"
    fi
    probe regression "$out/trees/candidate/performance/01-field-replacement.yaml" candidate "$repetition"
  done

  if [ "$(validation_read_receipt "$claims/emulator-$api")" = acquired ]; then
    SYNCSCOPE_RESOURCE_RECEIPT="$claims/emulator-$api" "$repo/scripts/validation/android-validator.sh" stop \
      --api "$api" --avd "dependency_api$api" \
      --state "$(validation_state "api$api")" \
      --exclusive-lock "$validator_lock"
  fi
done
