#!/bin/sh
set -eu

action=${1:-}
shift || true
api=
avd=
state=
exclusive_lock=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --api) api=${2:-}; shift 2 ;;
    --avd) avd=${2:-}; shift 2 ;;
    --state) state=${2:-}; shift 2 ;;
    --exclusive-lock) exclusive_lock=${2:-}; shift 2 ;;
    *) exit 64 ;;
  esac
done
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/validation-lifecycle.sh"
repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
case "$api:$avd" in
  31:dependency_api31|36:dependency_api36) ;;
  *) exit 64 ;;
esac
[ "$state" = "$(validation_state "api$api")" ] || exit 64
[ "$exclusive_lock" = "$(validation_state validator.lock)" ] || exit 64

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/android-sdk.sh"
android_sdk_resolve

adb="$ANDROID_HOME/platform-tools/adb"
emulator="$ANDROID_HOME/emulator/emulator"
owner="$state/owner"
pid_file="$state/pid"
serial_file="$state/serial"

adb_command() {
  timeout --signal=TERM --kill-after=5 30 "$adb" "$@"
}

memory_ready() {
  available=$(awk '/^MemAvailable:/ {print $2}' "${SYNCSCOPE_MEMINFO_FILE:-/proc/meminfo}")
  total=$(awk '/^MemTotal:/ {print $2}' "${SYNCSCOPE_MEMINFO_FILE:-/proc/meminfo}")
  [ "$available" -ge 8388608 ] && [ $((available * 100 / total)) -ge 30 ]
}
owned_running() {
  [ -f "$owner" ] && [ "$(cat "$owner")" = "$api:$avd" ] &&
    validation_process_owned "$state"
}
owned_state() {
  [ -f "$owner" ] && [ "$(cat "$owner")" = "$api:$avd" ]
}
retain_diagnostics() {
  [ -n "${SYNCSCOPE_PERFORMANCE_DIR:-}" ] || return 0
  destination="$SYNCSCOPE_PERFORMANCE_DIR/raw/validator-$api"
  # Each owned lifecycle keeps its own private copy (calibration starts the
  # same API's validator once per candidate).
  retained=2
  while [ -e "$destination" ]; do
    destination="$SYNCSCOPE_PERFORMANCE_DIR/raw/validator-$api-$retained"
    retained=$((retained + 1))
  done
  mkdir -p "$SYNCSCOPE_PERFORMANCE_DIR/raw" && mkdir "$destination"
  for file in owner claim pid process-identity serial devices.before processes.private metadata.private.json emulator.log emulator-lifetime-seconds invocation-mode watchdog.private acceleration.private.json attempts.plan; do
    [ ! -f "$state/$file" ] || cp "$state/$file" "$destination/$file"
  done
  for file in "$state"/emulator-attempt-*.log; do
    [ ! -f "$file" ] || cp "$file" "$destination/${file##*/}"
  done
}
accel() {
  node "$repo/scripts/validation/performance-report.mjs" "$@"
}
# Releases only the current candidate's own process and serial, then keeps its
# log beside the other attempts before the next candidate may use port 5554.
release_attempt() {
  if [ -f "$serial_file" ] && owned_running && owned_serial; then
    adb_command -s "$serial" emu kill >/dev/null 2>&1 || true
  fi
  if [ -f "$pid_file" ]; then
    validation_stop_process "$state" || true
    wait "$(cat "$pid_file")" 2>/dev/null || true
  fi
  [ ! -f "$state/emulator.log" ] || mv -- "$state/emulator.log" "$state/emulator-attempt-$attempt_number.log"
  rm -f -- "$pid_file" "$state/process-identity" "$serial_file" \
    "$state/metadata.private.json" "$state/processes.private"
}
# Explicit console port + saved inventory + AVD + the owning process's listening
# socket prove the serial. A transport appearing during startup is not ownership.
owned_serial() {
  owned_running || return 1
  [ "$serial" = emulator-5554 ] || return 1
  [ "$(adb_command -s "$serial" emu avd name 2>/dev/null | tr -d '\r' | sed '/^OK$/d')" = "$avd" ] || return 1
  node - "$(cat "$pid_file")" "$avd" >"$state/processes.private" <<'NODE'
const fs = require('node:fs');
const group = process.argv[2], avd = process.argv[3];
const inodes = new Set();
for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
  for (const line of fs.readFileSync(table, 'utf8').trim().split('\n').slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (fields[1].endsWith(':15B2') && fields[3] === '0A') inodes.add(fields[9]);
  }
}
let owned = false;
for (const pid of fs.readdirSync('/proc').filter(p => /^\d+$/.test(p))) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) /, '').split(' ');
    if (stat[2] !== group) continue;
    console.log(pid);
    const argv = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
    if (argv[argv.indexOf('-avd') + 1] !== avd || argv[argv.indexOf('-port') + 1] !== '5554') continue;
    for (const fd of fs.readdirSync(`/proc/${pid}/fd`)) {
      const inode = fs.readlinkSync(`/proc/${pid}/fd/${fd}`).match(/^socket:\[(\d+)\]$/)?.[1];
      if (inodes.has(inode)) owned = true;
    }
  } catch {}
}
process.exit(owned ? 0 : 1);
NODE
}
# Poll until root/unroot has restarted adbd with the expected shell identity.
await_shell_uid() {
  tries=0
  until [ "$(adb_command -s "$serial" shell id -u 2>/dev/null | tr -d '\r')" = "$1" ]; do
    tries=$((tries + 1))
    [ "$tries" -lt 60 ] || return 1
    sleep 1
  done
}
# userdebug images run llkd, which kills adbd once a child of adbd has been a
# zombie for 600 s. Maestro keeps the shell that launched its on-device driver
# open for the whole `maestro test` run, so every run longer than about ten
# minutes lost the device mid-flow ("device offline", the guest log shows
# "livelock: Killing ... adbd ... in Z state"). llkd guards the platform, not
# the app under test, so it is stopped once per boot: root only for that, then
# back to the normal shell user every script and flow expects.
watchdog_event() {
  printf '%s:%s\n' "$1" "$2" >>"$state/watchdog.private"
}
await_llkd_stopped() {
  watchdog_attempts=0
  while :; do
    owned_running || { watchdog_event ownership failed; return 1; }
    watchdog_pending=0
    for watchdog_service in 0 1; do
      # Do not pipe the adb read: a failed transport must not become an empty
      # property and satisfy a negative "not running" test.
      watchdog_value=$(adb_command -s "$serial" shell getprop "init.svc.llkd-$watchdog_service" 2>/dev/null) ||
        { watchdog_event "service-$watchdog_service" failed; return 1; }
      watchdog_value=$(printf '%s' "$watchdog_value" | tr -d '\r')
      case "$watchdog_value" in
        stopped) watchdog_event "service-$watchdog_service" stopped ;;
        running|restarting) watchdog_pending=1; watchdog_event "service-$watchdog_service" pending ;;
        '')
          # Some images define only llkd-1. A successful empty read for llkd-0
          # after full boot means it is absent, not a failed observation.
          [ "$watchdog_service" = 0 ] ||
            { watchdog_event "service-$watchdog_service" failed; return 1; }
          watchdog_event service-0 absent ;;
        *) watchdog_event "service-$watchdog_service" failed; return 1 ;;
      esac
    done
    [ "$watchdog_pending" -ne 0 ] || return 0
    watchdog_attempts=$((watchdog_attempts + 1))
    [ "$watchdog_attempts" -lt 60 ] || { watchdog_event shutdown failed; return 1; }
    sleep 1
  done
}
stop_llkd() {
  watchdog_event root requested
  # `adb root`/`adb unroot` restart adbd, and the client can lose its channel
  # and exit nonzero although the restart succeeded. The exit is recorded, but
  # only the shell uid observed within the existing poll proves the switch.
  adb_command -s "$serial" root >/dev/null 2>&1 || watchdog_event root nonzero
  watchdog_status=0
  if ! await_shell_uid 0; then
    watchdog_event root-uid failed
    watchdog_status=1
  else
    watchdog_event root-uid verified
    # ctl.stop is asynchronous. Check each request's exit status, then wait for
    # affirmative shutdown while still root, before restarting adbd as shell.
    for watchdog_service in 0 1; do
      if ! adb_command -s "$serial" shell setprop ctl.stop "llkd-$watchdog_service"; then
        watchdog_event "stop-$watchdog_service" failed
        watchdog_status=1
        break
      fi
      watchdog_event "stop-$watchdog_service" requested
    done
    [ "$watchdog_status" -ne 0 ] || await_llkd_stopped || watchdog_status=1
  fi
  # Restore the normal shell even when a stop request/observation fails; none
  # of those failures is waived by successful restoration.
  watchdog_event unroot requested
  adb_command -s "$serial" unroot >/dev/null 2>&1 || watchdog_event unroot nonzero
  await_shell_uid 2000 || { watchdog_event shell-uid failed; return 1; }
  watchdog_event unroot-uid verified
  [ "$watchdog_status" -eq 0 ] || return 1
  watchdog_event shutdown passed
}
serial_ready() {
  [ -f "$serial_file" ] || return 1
  serial=$(cat "$serial_file")
  [ "$(adb_command -s "$serial" get-state 2>/dev/null)" = device ] &&
    [ "$(adb_command -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] &&
    adb_command -s "$serial" shell ip route 2>/dev/null |
      grep -Fq '10.0.2.0/24'
}

case "$action" in
  start)
    if owned_running && serial_ready; then
      validation_claim_matches "$state" || exit 1
      owned_serial || exit 1
      validation_receipt borrowed
      exit 0
    fi
    [ ! -e "$state" ] || {
      printf 'Validator state %s already exists; stop that validator first.\n' "$state" >&2
      exit 1
    }
    # Only the authoritative full invocation can request the finite measurement
    # policy. FD 6 is its inherited locked open-file description (not a fresh
    # lock), and the mode record is scoped to this API's acquisition receipt.
    # Borrowed emulators return above without changing their original deadline.
    lifetime=9000
    invocation_mode=standalone
    if [ -n "${SYNCSCOPE_INVOCATION_MODE_FILE:-}" ]; then
      mode_file=$SYNCSCOPE_INVOCATION_MODE_FILE
      case "$mode_file" in /tmp/cloud-sync-checker-claims-*/invocation-mode) ;; *) exit 1 ;; esac
      [ "$(dirname -- "$mode_file")/emulator-$api" = "${SYNCSCOPE_RESOURCE_RECEIPT:-}" ] || exit 1
      [ -f "$mode_file" ] && [ ! -L "$mode_file" ] &&
        [ ! -L "$(dirname -- "$mode_file")" ] &&
        [ "$(realpath -- "$mode_file")" = "$mode_file" ] &&
        [ "$(stat -c %u:%a "$mode_file")" = "$(id -u):600" ] &&
        [ "$(stat -c %u:%a "$(dirname -- "$mode_file")")" = "$(id -u):700" ] || exit 1
      [ -n "${SYNCSCOPE_INVOCATION_TOKEN:-}" ] || exit 1
      invocation_mode=$(cat "$mode_file")
      case "$invocation_mode" in
        "$SYNCSCOPE_INVOCATION_TOKEN":connected|"$SYNCSCOPE_INVOCATION_TOKEN":e2e|"$SYNCSCOPE_INVOCATION_TOKEN":measure) ;;
        *) exit 1 ;;
      esac
      [ "$(wc -c <"$mode_file")" -eq "$((${#invocation_mode} + 1))" ] || exit 1
      invocation_lock=$(validation_state invocation.lock)
      [ -f "$invocation_lock" ] && [ ! -L "$invocation_lock" ] &&
        [ "$(stat -c %u "$invocation_lock")" = "$(id -u)" ] &&
        [ "$(stat -Lc %d:%i "/proc/$$/fd/6" 2>/dev/null)" = "$(stat -c %d:%i "$invocation_lock")" ] &&
        flock -n 6 || exit 1
      invocation_mode=${invocation_mode#*:}
      [ "$invocation_mode" != measure ] || lifetime=14400
    fi
    # Finite graphics profiles only. Without a request the original legacy
    # launch is reproduced unchanged. A pinned candidate exists solely for the
    # authenticated measurement calibration of one discovered route.
    graphics_profile=${SYNCSCOPE_GRAPHICS_PROFILE:-legacy}
    case "$graphics_profile" in legacy|auto|host-opengl|software) ;; *) exit 64 ;; esac
    graphics_candidate=${SYNCSCOPE_GRAPHICS_CANDIDATE:--}
    case "$graphics_candidate" in
      -|host-intel-[1-9]|host-nvidia-[1-9]|software-swiftshader|software-software|software-lavapipe|software-swangle) ;;
      *) exit 64 ;;
    esac
    graphics_pin=${SYNCSCOPE_GRAPHICS_PIN:-0}
    case "$graphics_pin:$invocation_mode" in 0:*|1:measure) ;; *) exit 64 ;; esac
    if [ -n "${SYNCSCOPE_HOST_ROOT:-}" ]; then
      # A private read-only host image for deterministic tests, never a path
      # outside this tool's own scratch namespace.
      case "$SYNCSCOPE_HOST_ROOT" in /tmp/cloud-sync-checker-*/host) ;; *) exit 64 ;; esac
      [ -d "$SYNCSCOPE_HOST_ROOT" ] && [ ! -L "$SYNCSCOPE_HOST_ROOT" ] &&
        [ "$(realpath -- "$SYNCSCOPE_HOST_ROOT")" = "$SYNCSCOPE_HOST_ROOT" ] &&
        [ "$(stat -c %u "$SYNCSCOPE_HOST_ROOT")" = "$(id -u)" ] || exit 64
    fi
    memory_ready || {
      printf '%s\n' "Validator memory preflight failed." >&2
      exit 1
    }
    validation_lock_safe "$exclusive_lock" || exit 1
    exec 8>>"$exclusive_lock"
    flock -n 8 || { printf '%s\n' "Another validator owns the emulator lock." >&2; exit 1; }
    if adb_command devices |
      awk 'NR > 1 && ($2 == "device" || $1 == "emulator-5554") {found=1} END {exit !found}'; then
      printf '%s\n' "Another connected validator is active." >&2
      exit 1
    fi
    mkdir "$state"
    candidate=
    cleanup_failed_start() {
      status=$?
      trap - EXIT HUP INT TERM
      if [ "$status" -eq 130 ] && [ -n "$candidate" ]; then
        accel acceleration-attempt "$state" "$candidate" fail interrupted 2>/dev/null || true
      fi
      validation_stop_process "$state" || true
      retain_diagnostics || true
      rm -rf -- "$state"
      validation_receipt released
      exit "$status"
    }
    trap cleanup_failed_start EXIT
    trap 'exit 130' HUP INT TERM
    printf '%s\n' "$api:$avd" >"$owner"
    validation_mark_claim "$state"
    printf '%s\n' "$lifetime" >"$state/emulator-lifetime-seconds"
    printf '%s\n' "$invocation_mode" >"$state/invocation-mode"
    : >"$state/devices.before"
    adb_command devices |
      awk 'NR > 1 && $1 != "" {print $1}' >"$state/devices.before"

    accel acceleration-plan "$state" "$ANDROID_HOME" "$api" "$graphics_profile" \
      "$graphics_candidate" "$graphics_pin" >"$state/attempts.plan"

    # Each candidate is an exclusively owned attempt: its own process group,
    # serial proof, readiness/watchdog handling and runtime verification. A
    # rejected attempt releases only its own resources before the next one.
    # Measurement alone has an approved four-hour owned-emulator cap.
    # All other modes retain 9000 seconds; no arbitrary lifetime override.
    selected=
    attempt_number=0
    while IFS= read -r candidate <&7; do
      attempt_number=$((attempt_number + 1))
      launch=$(accel acceleration-launch "$state" "$candidate")
      gpu_args=$(printf '%s\n' "$launch" | sed -n 1p)
      launch_env=$(printf '%s\n' "$launch" | sed 1d | tr '\n' ' ')
      # Both values are fixed allowlisted tokens without whitespace.
      # shellcheck disable=SC2086
      setsid timeout --signal=TERM --kill-after=20 "$lifetime" \
        env $launch_env "$emulator" -avd "$avd" -no-window -no-snapshot -no-boot-anim -no-audio \
        $gpu_args -memory 2048 -no-metrics -port 5554 \
        >"$state/emulator.log" 2>&1 6>&- 7<&- 9>&- &
      pid=$!
      validation_save_pid "$pid" "$state"
      accel acceleration-attempt "$state" "$candidate" starting
      sleep 1

      failure=
      attempts=0
      serial=emulator-5554
      until [ "$(adb_command -s "$serial" get-state 2>/dev/null)" = device ]; do
        owned_running || { failure='emulator-exited|Emulator or validator lock failed to start.'; break; }
        attempts=$((attempts + 1))
        [ "$attempts" -lt 180 ] || { failure='boot-timeout|The emulator did not come online within 180 s.'; break; }
        sleep 1
      done
      if [ -z "$failure" ]; then
        printf '%s\n' "$serial" >"$serial_file"
        owned_serial || failure='ownership-unproven|Cannot prove emulator serial/process ownership.'
      fi
      if [ -z "$failure" ]; then
        attempts=0
        until serial_ready; do
          attempts=$((attempts + 1))
          [ "$attempts" -lt 240 ] || { failure='route-timeout|Emulator route readiness timed out.'; break; }
          sleep 1
        done
      fi
      if [ -z "$failure" ]; then
        stop_llkd || failure='watchdog-failed|Could not stop llkd on the validation emulator.'
      fi
      if [ -z "$failure" ]; then
        attempts=0
        until serial_ready; do
          attempts=$((attempts + 1))
          [ "$attempts" -lt 60 ] || { failure='route-timeout|Emulator route readiness timed out after stopping llkd.'; break; }
          sleep 1
        done
      fi
      if [ -z "$failure" ]; then
        owned_serial || failure='ownership-unproven|Cannot prove emulator ownership after stopping llkd.'
      fi
      if [ -z "$failure" ]; then
        accel acceleration-attempt "$state" "$candidate" ready
        # Boot completion alone is not graphics verification: the guest
        # renderer, KVM and owned render-node identity decide the attempt.
        node "$repo/scripts/validation/performance-report.mjs" capture-device \
          "$state/metadata.private.json" "$ANDROID_HOME" "$serial" "$api" "$avd" "$state" "$candidate" ||
          failure='metadata-failed|Could not record the emulator runtime identity.'
      fi
      if [ -z "$failure" ]; then
        accel acceleration-attempt "$state" "$candidate" verify ||
          failure="-|Graphics candidate $candidate failed runtime verification."
      fi
      if [ -n "$failure" ]; then
        printf '%s\n' "${failure#*|}" >&2
        [ "${failure%%|*}" = - ] ||
          accel acceleration-attempt "$state" "$candidate" fail "${failure%%|*}"
        release_attempt
        continue
      fi
      selected=$candidate
      break
    done 7<"$state/attempts.plan"
    candidate=
    [ -n "$selected" ] || {
      accel acceleration-exhausted "$state" "$api"
      exit 1
    }
    accel acceleration-attempt "$state" "$selected" select
    validation_receipt acquired
    trap - EXIT HUP INT TERM
    ;;
  healthcheck)
    owned_running && serial_ready && owned_serial
    ;;
  stop)
    owned_state && validation_claim_matches "$state" || {
      printf '%s\n' "Refusing to stop an unowned validator." >&2
      exit 1
    }
    if [ -f "$serial_file" ] && owned_running; then
      serial=$(cat "$serial_file")
      if owned_serial; then adb_command -s "$serial" emu kill >/dev/null 2>&1 || true; fi
    fi
    if [ -f "$pid_file" ]; then
      validation_stop_process "$state" || true
    fi
    retain_diagnostics
    rm -rf -- "$state"
    validation_receipt released
    ;;
  *) exit 64 ;;
esac
