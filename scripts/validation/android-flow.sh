#!/bin/sh
set -eu

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/android-sdk.sh"

mode=${1:-}
shift || true
apis=
graphics=software
# Without --graphics the original legacy launch is reproduced unchanged; the
# report still records its requested category as software.
graphics_profile=legacy
report_dir=${SYNCSCOPE_VALIDATION_REPORT_DIR:-}
while [ "$#" -gt 0 ]; do
  case "$1" in
    --api)
      case "${2:-}" in 31|36) apis="$apis ${2:-}" ;; *) exit 64 ;; esac
      shift 2
      ;;
    --graphics)
      case "${2:-}" in auto|host-opengl|software) graphics=$2; graphics_profile=$2 ;; *) exit 64 ;; esac
      shift 2
      ;;
    --report-dir)
      [ -n "${2:-}" ] || exit 64
      case "$2" in --*) exit 64 ;; esac
      report_dir=$2
      shift 2
      ;;
    *) exit 64 ;;
  esac
done
case "$mode" in connected|e2e|measure) ;; *) exit 64 ;; esac
[ -n "$apis" ] || apis=" 31"
seen=
for requested_api in $apis; do
  case " $seen " in *" $requested_api "*) exit 64 ;; esac
  seen="$seen $requested_api"
done

repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
SYNCSCOPE_GRAPHICS_PROFILE=$graphics_profile
export SYNCSCOPE_GRAPHICS_PROFILE
# Candidate pins/preferences are set only by this runner per validator start.
unset SYNCSCOPE_GRAPHICS_CANDIDATE SYNCSCOPE_GRAPHICS_PIN
schedule=
if [ "$mode" = measure ]; then
  # Measurement cannot accept hidden dataset overrides from the environment.
  [ -z "${BULK_FILES+x}${GALLERY_BULK_FILES+x}${SCROLL_COUNT+x}${NARROW_COUNT+x}" ] || exit 64
  schedule=$(node "$repo/scripts/validation/performance-report.mjs" schedule "$repo") || exit 64
fi
android_sdk_resolve
. "$repo/scripts/validation/validation-lifecycle.sh"
# Keep the lock inode stable. Unlinking a flock file permits concurrent owners.
invocation_lock=$(validation_state invocation.lock)
validation_lock_safe "$invocation_lock" || exit 1
exec 9>>"$invocation_lock"
flock -n 9 || { printf '%s\n' "Another validation invocation is active." >&2; exit 1; }
SYNCSCOPE_INVOCATION_TOKEN=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
export SYNCSCOPE_INVOCATION_TOKEN
claims=$(mktemp -d /tmp/cloud-sync-checker-claims-XXXXXX)
SYNCSCOPE_INVOCATION_MODE_FILE="$claims/invocation-mode"
printf '%s:%s\n' "$SYNCSCOPE_INVOCATION_TOKEN" "$mode" >"$SYNCSCOPE_INVOCATION_MODE_FILE"
export SYNCSCOPE_INVOCATION_MODE_FILE
validator_lock=$(validation_state validator.lock)
metro_state=$(validation_state metro)
compose="$repo/validation/services/compose.yaml"
maestro_bin=${SYNCSCOPE_MAESTRO_BIN:-"$HOME/.cache/cloud-sync-checker-toolchain/maestro-2.10.0/maestro/bin/maestro"}
hooks="$repo/scripts/validation/hooks"
# The staged flows all use the SFTP seam, so their host-side hooks act on the
# SFTP service's fixture tree. Every protocol's tree is the same seed, so the
# expected sizes are measured from it too.
staged_state=$(validation_state syncscope-sftp)
gradle_pid=
paused_protocols=
SYNCSCOPE_PERFORMANCE_DIR=
artifact_counter=0
maestro_pid=
sample_scenario=none
sample_repetition=0
expected_artifacts=1
measure_status=0

cleanup() {
  status=$?
  # A repeated signal must not abandon acquired resources mid-release. A no-op
  # trap (not SIG_IGN) keeps default dispositions for the children cleanup runs.
  trap - EXIT
  trap ':' HUP INT TERM
  failure_code=validation
  restoration=unknown
  case "${phase_name:-}" in
    boot|services) failure_code=startup ;;
    build) failure_code=build ;;
    remote-fixtures|device-fixtures) failure_code=fixture ;;
  esac
  if [ -n "$maestro_pid" ]; then
    validation_stop_process "$claims/maestro" || true
    wait "$maestro_pid" 2>/dev/null || true
    capture_maestro "$status" || { [ "$status" -ne 0 ] || status=1; }
  fi
  validation_phase_end "$status" || { [ "$status" -ne 0 ] || status=1; }
  validation_phase_begin shared cleanup || { [ "$status" -ne 0 ] || status=1; }
  for protocol in $paused_protocols; do
    "$hooks/resume-service.sh" "$protocol" || { [ "$status" -ne 0 ] || status=1; }
  done
  case "$(validation_read_receipt "$claims/sftp" 2>/dev/null || true)" in acquired|borrowed)
    restoration=passed
    SYNCSCOPE_STATE_ROOT=$staged_state "$hooks/restore-recheck-file.sh" ||
      { restoration=failed; [ "$status" -ne 0 ] || { status=1; failure_code=restoration; }; }
    # staged/09-resync (feature 009) removes the tree set's new.jpg between its
    # parts a and b; a run stopped before part c's hook must still leave the
    # seeded tree for the services' before-manifest check.
    SYNCSCOPE_STATE_ROOT=$staged_state "$hooks/restore-recheck-file.sh" scan/tree/Album/2025/new.jpg ||
      { restoration=failed; [ "$status" -ne 0 ] || { status=1; failure_code=restoration; }; }
    ;;
  esac
  if [ -n "$gradle_pid" ]; then
    validation_stop_process "$claims/gradle" || true
    wait "$gradle_pid" 2>/dev/null || true
  fi
  case "$(validation_read_receipt "$claims/metro" 2>/dev/null || true)" in
    acquired)
    SYNCSCOPE_RESOURCE_RECEIPT="$claims/metro" "$repo/scripts/validation/metro-service.sh" stop \
      --host 127.0.0.1 --port 8081 \
      --state "$metro_state" || { [ "$status" -ne 0 ] || status=1; }
    ;;
    borrowed)
    "$repo/scripts/validation/metro-service.sh" healthcheck \
      --host 127.0.0.1 --port 8081 --state "$metro_state" ||
      { [ "$status" -ne 0 ] || status=1; }
    ;;
  esac
  # A child may finish acquisition immediately before a signal. Consult each
  # precise per-API receipt, never an in-memory flag set after that handoff.
  for cleanup_api in $apis; do
    case "$(validation_read_receipt "$claims/emulator-$cleanup_api" 2>/dev/null || true)" in
      acquired) validator_action=stop ;;
      borrowed) validator_action=healthcheck ;;
      *) continue ;;
    esac
    SYNCSCOPE_RESOURCE_RECEIPT="$claims/emulator-$cleanup_api" "$repo/scripts/validation/android-validator.sh" "$validator_action" \
      --api "$cleanup_api" --avd "dependency_api$cleanup_api" \
      --state "$(validation_state "api$cleanup_api")" \
      --exclusive-lock "$validator_lock" || { [ "$status" -ne 0 ] || status=1; }
  done
  for protocol in ftp webdav sftp; do
    case "$protocol" in
      sftp) port=32122; passive= ;;
      webdav) port=32180; passive= ;;
      ftp) port=32120; passive='--passive-ports 32200-32209' ;;
    esac
    case "$(validation_read_receipt "$claims/$protocol" 2>/dev/null || true)" in
      acquired) service_action=stop ;;
      borrowed) service_action=audit ;;
      *) continue ;;
    esac
    # shellcheck disable=SC2086
    SYNCSCOPE_RESOURCE_RECEIPT="$claims/$protocol" "$repo/scripts/validation/protocol-service.sh" "$service_action" "$protocol" \
      --compose "$compose" --project "syncscope-$protocol" \
      --host 127.0.0.1 --port "$port" $passive ||
      { [ "$status" -ne 0 ] || { status=1; failure_code=audit; }; }
  done
  if [ -n "$SYNCSCOPE_PERFORMANCE_DIR" ]; then
    cp -R "$claims" "$SYNCSCOPE_PERFORMANCE_DIR/raw/lifecycle" ||
      { [ "$status" -ne 0 ] || status=1; }
  fi
  rm -rf -- "$claims" || { [ "$status" -ne 0 ] || status=1; }
  validation_phase_end "$status" || { [ "$status" -ne 0 ] || status=1; }
  if [ -n "$SYNCSCOPE_PERFORMANCE_DIR" ]; then
    node "$repo/scripts/validation/performance-report.mjs" finish \
      "$SYNCSCOPE_PERFORMANCE_DIR" "$status" "$(validation_now)" "$failure_code" "$restoration" ||
      { [ "$status" -ne 0 ] || status=1; }
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM
[ -n "$report_dir" ] || report_dir="$repo/validation/evidence/performance"
# shellcheck disable=SC2086
SYNCSCOPE_PERFORMANCE_DIR=$(node "$repo/scripts/validation/performance-report.mjs" init \
  "$repo" "$report_dir" "$mode" "$graphics" $apis)
export SYNCSCOPE_PERFORMANCE_DIR

adb() {
  timeout --signal=TERM --kill-after=10 "${ADB_TIMEOUT:-60}" \
    "$ANDROID_HOME/platform-tools/adb" -s "$serial" "$@"
}

# size_of <fixture path>...: the byte sum of files fixture-seed.sh wrote.
size_of() {
  (cd "$staged_state/fixtures" && cat -- "$@") | wc -c | tr -d ' '
}

# The pinned driver receives explicit destinations; no "latest" discovery.
prepare_maestro() {
  artifact_counter=$((artifact_counter + 1))
  artifact_id="raw-$api-$artifact_counter"
  artifact="$SYNCSCOPE_PERFORMANCE_DIR/raw/$artifact_id"
  mkdir -m 700 "$artifact"
  mkdir -m 700 "$artifact/output" "$artifact/debug"
  sample_start=$(validation_now)
}
capture_maestro() {
  captured_status=$1
  sample_end=$(validation_now)
  if ! node "$repo/scripts/validation/performance-report.mjs" artifact \
    "$SYNCSCOPE_PERFORMANCE_DIR" "$api" "$artifact_id" "$sample_scenario" \
    "$sample_repetition" "$sample_start" "$sample_end" "$captured_status" "$expected_artifacts"; then
    [ "$captured_status" -ne 0 ] || captured_status=1
  fi
  maestro_pid=
  return "$captured_status"
}
await_maestro() {
  mkdir -p "$claims/maestro"
  validation_save_pid "$maestro_pid" "$claims/maestro" 2>/dev/null || true
  maestro_status=0
  wait "$maestro_pid" || maestro_status=$?
  capture_maestro "$maestro_status"
}
# run_flow <flow> <maestro -e arguments>...
run_flow() {
  flow=$1
  shift
  prepare_maestro || return 1
  expected_artifacts=1
  setsid timeout --signal=TERM --kill-after=10 900 \
    "$maestro_bin" test "$@" "$repo/validation/maestro/$flow" \
    --test-output-dir "$artifact/output" --debug-output "$artifact/debug" \
    >"$artifact/maestro.log" 2>&1 </dev/null 9>&- &
  maestro_pid=$!
  await_maestro
}

# run_hook <hook and args>: one host hook of a staged line. A pause registers
# its resume in cleanup() before it runs, so the service always comes back.
run_hook() {
  hook=${1%% *}
  hook_args=
  [ "$hook" = "$1" ] || hook_args=${1#* }
  case "$hook" in
    '' | */* | .*)
      printf 'Invalid staged hook: %s\n' "$1" >&2
      exit 1
      ;;
  esac
  case "$hook" in
    pause-service.sh*) paused_protocols="$paused_protocols $hook_args" ;;
  esac
  # shellcheck disable=SC2086
  SYNCSCOPE_STATE_ROOT=$staged_state "$hooks/$hook" $hook_args </dev/null
  case "$hook" in
    resume-service.sh*)
      remaining=
      for protocol in $paused_protocols; do
        [ "$protocol" = "$hook_args" ] || remaining="$remaining $protocol"
      done
      paused_protocols=$remaining
      ;;
  esac
}

# run_staged_pairs <maestro -e arguments>...: each line of staged/pairs.txt is
# <flow>|<hook and args>|<flow>[|<hook and args>|<flow>…]. Only the first flow
# of a line starts from clearState; the flows themselves declare it.
run_staged_pairs() {
  pairs="$repo/validation/maestro/staged/pairs.txt"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in '' | '#'*) continue ;; esac
    rest=$line
    index=0
    while :; do
      part=${rest%%|*}
      part=$(printf '%s' "$part" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
      if [ $((index % 2)) -eq 0 ]; then
        run_flow "$part" "$@"
      else
        run_hook "$part"
      fi
      [ "$rest" != "${rest#*|}" ] || break
      rest=${rest#*|}
      index=$((index + 1))
    done
    if [ $((index % 2)) -ne 0 ]; then
      printf 'Staged line must end with a flow: %s\n' "$line" >&2
      exit 1
    fi
  done <"$pairs"
}

debug_apk="$repo/android/app/build/outputs/apk/debug/app-debug.apk"
if [ "$mode" = e2e ] || [ "$mode" = measure ]; then
  # Feature 008 (T041, research R9): one debug assembly per invocation, before
  # any service, emulator or API loop, so a failed build acquires nothing and
  # every API installs the same recorded APK. Only the emulator ABI is built,
  # through the documented override in android/gradle.properties; release and
  # connected builds keep every ABI. Gradle always runs (no "APK exists" skip),
  # so its own up-to-date checks decide what is rebuilt.
  validation_phase_begin shared build
  gradle_log="$SYNCSCOPE_PERFORMANCE_DIR/raw/build-shared.log"
  setsid timeout --signal=TERM --kill-after=20 1200 \
    "$repo/android/gradlew" -p "$repo/android" --no-daemon \
    -PreactNativeArchitectures=x86_64 \
    :app:assembleDebug >"$gradle_log" 2>&1 9>&- &
  gradle_pid=$!
  mkdir -p "$claims/gradle"
  validation_save_pid "$gradle_pid" "$claims/gradle" 2>/dev/null || true
  wait "$gradle_pid"
  gradle_pid=
  validation_phase_end 0
  node "$repo/scripts/validation/performance-report.mjs" build \
    "$SYNCSCOPE_PERFORMANCE_DIR" "$debug_apk" "$gradle_log"
fi

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

if [ "$mode" = e2e ] || [ "$mode" = measure ]; then
  validation_phase_begin shared services
  SYNCSCOPE_RESOURCE_RECEIPT="$claims/metro" "$repo/scripts/validation/metro-service.sh" start \
    --host 127.0.0.1 --port 8081 \
    --state "$metro_state" 9>&-
  case "$(validation_read_receipt "$claims/metro")" in acquired|borrowed) ;; *) exit 1 ;; esac
  validation_phase_end 0
fi

# The expected values of the generated Scroll and Narrow sources (feature 007),
# computed once from the same functions device-fixtures.sh seeds them with.
scroll_manifest=$("$repo/scripts/validation/scroll-manifest.sh" print)

for api in $apis; do
  # Automatic measurement without a ranking for the current inputs calibrates
  # every viable candidate on the frozen workload; otherwise one pass.
  api_candidates=-
  calibrating=0
  if [ "$mode" = measure ] && [ "$graphics_profile" = auto ]; then
    calibration=$(node "$repo/scripts/validation/performance-report.mjs" calibration-plan \
      "$SYNCSCOPE_PERFORMANCE_DIR" "$repo" "$api" "$ANDROID_HOME")
    if [ -n "$calibration" ]; then
      api_candidates=$calibration
      calibrating=1
    fi
  fi
  preferred=-
  if [ "$graphics_profile" = auto ] && [ "$calibrating" -eq 0 ]; then
    preferred=$(node "$repo/scripts/validation/performance-report.mjs" ranking-preference \
      "$SYNCSCOPE_PERFORMANCE_DIR" "$api")
  fi
  for candidate in $api_candidates; do
  unset SYNCSCOPE_GRAPHICS_CANDIDATE SYNCSCOPE_GRAPHICS_PIN
  if [ "$calibrating" -eq 1 ]; then
    SYNCSCOPE_GRAPHICS_CANDIDATE=$candidate
    SYNCSCOPE_GRAPHICS_PIN=1
    export SYNCSCOPE_GRAPHICS_CANDIDATE SYNCSCOPE_GRAPHICS_PIN
    node "$repo/scripts/validation/performance-report.mjs" calibration-begin \
      "$SYNCSCOPE_PERFORMANCE_DIR" "$api" "$candidate"
  elif [ "$preferred" != - ]; then
    # A ranking only orders attempts; its freshness is decided after boot.
    SYNCSCOPE_GRAPHICS_CANDIDATE=$preferred
    export SYNCSCOPE_GRAPHICS_CANDIDATE
  fi
  validation_phase_begin "$api" boot
  boot_status=0
  SYNCSCOPE_RESOURCE_RECEIPT="$claims/emulator-$api" "$repo/scripts/validation/android-validator.sh" start \
    --api "$api" --avd "dependency_api$api" \
    --state "$(validation_state "api$api")" \
    --exclusive-lock "$validator_lock" 6<&9 9>&- || boot_status=$?
  if [ "$boot_status" -ne 0 ]; then
    [ "$calibrating" -eq 1 ] || exit "$boot_status"
    # An incompatible candidate is a calibration result, not a phase failure;
    # a preflight or lock failure is not, and stops the invocation.
    validation_phase_end 0
    node "$repo/scripts/validation/performance-report.mjs" calibration-end \
      "$SYNCSCOPE_PERFORMANCE_DIR" "$api" "$candidate" boot-failed || exit "$boot_status"
    continue
  fi
  case "$(validation_read_receipt "$claims/emulator-$api")" in acquired|borrowed) ;; *) exit 1 ;; esac
  serial=$(cat "$(validation_state "api$api")/serial")
  metadata="$(validation_state "api$api")/metadata.private.json"
  if [ -f "$metadata" ]; then
    accelerator="$(validation_state "api$api")/acceleration.private.json"
    [ -f "$accelerator" ] || accelerator=
    # shellcheck disable=SC2086
    node "$repo/scripts/validation/performance-report.mjs" device \
      "$SYNCSCOPE_PERFORMANCE_DIR" "$api" "$metadata" $accelerator
    [ "$calibrating" -eq 1 ] ||
      node "$repo/scripts/validation/performance-report.mjs" selection \
        "$SYNCSCOPE_PERFORMANCE_DIR" "$api" "$repo"
  fi
  validation_phase_end 0
  if [ "$mode" = measure ] && [ "$graphics_profile" = legacy ]; then
    node "$repo/scripts/validation/performance-report.mjs" require-original-software \
      "$SYNCSCOPE_PERFORMANCE_DIR" "$api"
  elif [ "$mode" = measure ]; then
    node "$repo/scripts/validation/performance-report.mjs" require-verified \
      "$SYNCSCOPE_PERFORMANCE_DIR" "$api"
  fi
  export ANDROID_SERIAL="$serial"
  export SYNCSCOPE_SFTP_CREDENTIAL_FILE="$(validation_state syncscope-sftp)/credentials"
  export SYNCSCOPE_WEBDAV_CREDENTIAL_FILE="$(validation_state syncscope-webdav)/credentials"
  export SYNCSCOPE_FTP_CREDENTIAL_FILE="$(validation_state syncscope-ftp)/credentials"

  if [ "$mode" = connected ]; then
    validation_phase_begin "$api" build
    gradle_log="$SYNCSCOPE_PERFORMANCE_DIR/raw/build-$api.log"
    setsid timeout --signal=TERM --kill-after=20 1200 \
      "$repo/android/gradlew" -p "$repo/android" --no-daemon \
      :app:connectedDebugAndroidTest >"$gradle_log" 2>&1 9>&- &
    gradle_pid=$!
  fi
  if [ -n "$gradle_pid" ]; then
    mkdir -p "$claims/gradle"
    validation_save_pid "$gradle_pid" "$claims/gradle" 2>/dev/null || true
    wait "$gradle_pid"
    gradle_pid=
    validation_phase_end 0
    node "$repo/scripts/validation/performance-report.mjs" build \
      "$SYNCSCOPE_PERFORMANCE_DIR" "$debug_apk" "$gradle_log" "$api"
  fi

  if [ "$mode" = e2e ] || [ "$mode" = measure ]; then
    validation_phase_begin "$api" install
    # The shared build's APK; every API and calibration candidate gets the same one.
    # A locally installed release build is signed with another key, and Android
    # refuses to update it with the debug-signed one. Only in that case is the
    # app uninstalled first; every flow directory starts from clearState anyway.
    if ! installed=$(timeout --signal=TERM --kill-after=10 60 \
      "$ANDROID_HOME/platform-tools/adb" -s "$serial" install -r "$debug_apk" 2>&1); then
      case "$installed" in
        *INSTALL_FAILED_UPDATE_INCOMPATIBLE*)
          adb uninstall com.syncscope >/dev/null
          timeout --signal=TERM --kill-after=10 60 \
            "$ANDROID_HOME/platform-tools/adb" -s "$serial" install "$debug_apk"
          ;;
        *)
          printf '%s\n' "$installed" >&2
          exit 1
          ;;
      esac
    fi
  fi
  validation_phase_end 0
  if [ "$mode" != connected ]; then
    reset_device_fixtures() {
      validation_phase_begin "$api" device-fixtures || return 1
      fixture_status=0
      "$repo/scripts/validation/device-fixtures.sh" || fixture_status=$?
      validation_phase_end "$fixture_status" || return 1
      return "$fixture_status"
    }
    reset_device_fixtures
    validation_phase_begin "$api" device-fixtures
    node "$repo/scripts/validation/performance-report.mjs" fixtures \
      "$SYNCSCOPE_PERFORMANCE_DIR" "$staged_state/fixtures" "$ANDROID_HOME" "$serial"
    validation_phase_end 0
    # Per-run container credentials for the scan flows (D014). Ports match the
    # service table above, roots match ProtocolConnectInstrumentedTest, and the
    # emulator reaches the host loopback services at 10.0.2.2. The values are
    # only ever passed as maestro arguments, never printed.
    set --
    for protocol in ftp sftp webdav; do
      case "$protocol" in
        ftp) prefix=FTP; port=32120; remote_root=/; credential_file=$SYNCSCOPE_FTP_CREDENTIAL_FILE ;;
        sftp) prefix=SFTP; port=32122; remote_root=/srv/fixtures; credential_file=$SYNCSCOPE_SFTP_CREDENTIAL_FILE ;;
        webdav) prefix=WEBDAV; port=32180; remote_root=/webdav; credential_file=$SYNCSCOPE_WEBDAV_CREDENTIAL_FILE ;;
      esac
      user=$(sed -n 's/^username=//p' "$credential_file")
      password=$(sed -n 's/^password=//p' "$credential_file")
      if [ -z "$user" ] || [ -z "$password" ]; then
        printf 'Missing %s credentials in %s.\n' "$protocol" "$credential_file" >&2
        exit 1
      fi
      set -- "$@" \
        -e "${prefix}_HOST=10.0.2.2" \
        -e "${prefix}_PORT=$port" \
        -e "${prefix}_USER=$user" \
        -e "${prefix}_PASSWORD=$password" \
        -e "${prefix}_ROOT=$remote_root"
    done
    user=
    password=
    # Expected byte sums for the selection and deletion flows, measured from
    # the seeded fixtures (Principle III: never restated as literals).
    # SIZE_IMAGES_5 covers the five device Gallery PNGs: sunset, beach,
    # album/forest, harbor and drafts/draft. The host tree has no harbor.png or
    # draft.png, so gallery-partial/restricted/hidden.png stands in for both:
    # fixture-seed.sh writes it from PNG_HARBOR, and device-fixtures.sh pushes
    # harbor.png from PNG_HARBOR and copies it to drafts/draft.png. If
    # hidden.png ever stops being PNG_HARBOR, change this sum with it.
    set -- "$@" \
      -e "SIZE_BEACH=$(size_of gallery/beach.png)" \
      -e "SIZE_SYNC_2=$(size_of gallery/sunset.png gallery/beach.png)" \
      -e "SIZE_IMAGES_5=$(size_of gallery/sunset.png gallery/beach.png \
        gallery/album/forest.png gallery-partial/restricted/hidden.png \
        gallery-partial/restricted/hidden.png)" \
      -e "SIZE_SYNCED_3=$(size_of gallery/sunset.png gallery/beach.png \
        gallery/album/forest.png)"
    # Feature 007: the API level, for flows whose swipe points depend on the
    # screen layout (polish/03: API 36 lays out edge to edge).
    set -- "$@" -e "API_LEVEL=$api"
    # Feature 007: FIRST_SIZE_DESC, BAND_MONTH_LABEL, … from the scroll manifest.
    while IFS= read -r manifest_line; do
      [ -z "$manifest_line" ] || set -- "$@" -e "$manifest_line"
    done <<EOF
$scroll_manifest
EOF

    if [ "$mode" = e2e ]; then
      validation_phase_begin "$api" workspace
      # The whole workspace (003's sources flows and 004's scan flows, run in
      # order with fresh app state per scan flow) takes well over 10 minutes.
      # With 006's mvp/ flows the workspace runs about 55 minutes per API, so
      # the cap leaves headroom above that (2400 s cut it off at mvp/01).
      # Feature 008 appends performance/01-field-replacement: the 40-flow
      # software workspace took 4996 s on API 31 and 5400 s cut API 36 off
      # after 39 flows (T045, us1-regressions/rerun5), so the cap is 7200 s.
      prepare_maestro
      expected_artifacts=$(node "$repo/scripts/validation/performance-report.mjs" workspace-count "$repo")
      setsid timeout --signal=TERM --kill-after=10 7200 \
        "$maestro_bin" \
        test "$@" "$repo/validation/maestro" \
        --test-output-dir "$artifact/output" --debug-output "$artifact/debug" \
        >"$artifact/maestro.log" 2>&1 </dev/null 9>&- &
      maestro_pid=$!
      await_maestro
      validation_phase_end 0
      # Staged pairs: flows that change server or device state mid-scenario.
      validation_phase_begin "$api" staged
      run_staged_pairs "$@"
      SYNCSCOPE_STATE_ROOT=$staged_state "$hooks/restore-recheck-file.sh"
      SYNCSCOPE_STATE_ROOT=$staged_state "$hooks/restore-recheck-file.sh" scan/tree/Album/2025/new.jpg
      validation_phase_end 0
    elif [ "$mode" = measure ]; then
      # adb shell forwards stdin. Keep the frozen schedule off descriptor 0 so
      # fixture/hook children cannot drain later repetitions and skip proof.
      while IFS='|' read -r sample_scenario sample_repetition measured_flow <&7; do
        reset_status=0
        reset_device_fixtures || reset_status=$?
        validation_phase_begin "$api" remote-fixtures
        SYNCSCOPE_STATE_ROOT=$staged_state "$hooks/restore-recheck-file.sh" || reset_status=$?
        validation_phase_end "$reset_status"
        if [ "$reset_status" -ne 0 ]; then
          prepare_maestro
          capture_maestro "$reset_status" || true
          [ "$measure_status" -ne 0 ] || measure_status=$reset_status
          continue
        fi
        validation_phase_begin "$api" measurement
        result=0
        run_flow "$measured_flow" "$@" || result=$?
        validation_phase_end "$result"
        [ "$result" -eq 0 ] || { [ "$measure_status" -ne 0 ] || measure_status=$result; }
      done 7<<EOF
$schedule
EOF
      sample_scenario=none
      sample_repetition=0
    fi
  fi

  if [ "$calibrating" -eq 1 ]; then
    node "$repo/scripts/validation/performance-report.mjs" calibration-end \
      "$SYNCSCOPE_PERFORMANCE_DIR" "$api" "$candidate" measured "$(validation_state "api$api")"
  fi
  if [ "$(validation_read_receipt "$claims/emulator-$api")" = acquired ]; then
    validation_phase_begin "$api" cleanup
    SYNCSCOPE_RESOURCE_RECEIPT="$claims/emulator-$api" "$repo/scripts/validation/android-validator.sh" stop \
    --api "$api" --avd "dependency_api$api" \
    --state "$(validation_state "api$api")" \
      --exclusive-lock "$validator_lock"
    validation_phase_end 0
  fi
  done
  unset SYNCSCOPE_GRAPHICS_CANDIDATE SYNCSCOPE_GRAPHICS_PIN
  if [ "$calibrating" -eq 1 ]; then
    # Rank H03/H07/H08 medians of complete calibrations; the selected
    # candidate's scheduled samples become this API's measured cohort.
    node "$repo/scripts/validation/performance-report.mjs" rank \
      "$SYNCSCOPE_PERFORMANCE_DIR" "$api" "$repo" || exit 1
  fi
done
[ "$measure_status" -eq 0 ] || exit "$measure_status"
