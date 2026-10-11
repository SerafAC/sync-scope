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
  mkdir -p "$destination"
  for file in owner claim pid process-identity serial devices.before processes.private metadata.private.json emulator.log; do
    [ ! -f "$state/$file" ] || cp "$state/$file" "$destination/$file"
  done
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
stop_llkd() {
  adb_command -s "$serial" root >/dev/null 2>&1 || return 1
  await_shell_uid 0 || return 1
  adb_command -s "$serial" shell 'setprop ctl.stop llkd-0; setprop ctl.stop llkd-1' || return 1
  adb_command -s "$serial" unroot >/dev/null 2>&1 || return 1
  await_shell_uid 2000 || return 1
  [ "$(adb_command -s "$serial" shell getprop init.svc.llkd-1 2>/dev/null | tr -d '\r')" != running ]
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
    cleanup_failed_start() {
      status=$?
      trap - EXIT HUP INT TERM
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
    : >"$state/devices.before"
    adb_command devices |
      awk 'NR > 1 && $1 != "" {print $1}' >"$state/devices.before"

    # The emulator outlives one API's whole e2e pass (boot, install, about
    # 55 minutes of Maestro flows, the staged pairs); 2700 s cut 006's run off.
    setsid timeout --signal=TERM --kill-after=20 9000 \
      "$emulator" -avd "$avd" -no-window -no-snapshot -no-boot-anim -no-audio \
      -gpu swiftshader_indirect -memory 2048 -no-metrics -port 5554 \
      >"$state/emulator.log" 2>&1 9>&- &
    pid=$!
    validation_save_pid "$pid" "$state"
    sleep 1

    attempts=0
    serial=emulator-5554
    until [ "$(adb_command -s "$serial" get-state 2>/dev/null)" = device ]; do
      owned_running || {
        printf '%s\n' "Emulator or validator lock failed to start." >&2
        exit 1
      }
      attempts=$((attempts + 1))
      [ "$attempts" -lt 180 ] || {
        printf '%s\n' "The emulator did not come online within 180 s." >&2
        exit 1
      }
      sleep 1
    done
    printf '%s\n' "$serial" >"$serial_file"
    owned_serial || { printf '%s\n' "Cannot prove emulator serial/process ownership." >&2; exit 1; }

    attempts=0
    until serial_ready; do
      attempts=$((attempts + 1))
      [ "$attempts" -lt 240 ] || {
        printf '%s\n' "Emulator route readiness timed out." >&2
        exit 1
      }
      sleep 1
    done
    stop_llkd || {
      printf '%s\n' "Could not stop llkd on the validation emulator." >&2
      exit 1
    }
    attempts=0
    until serial_ready; do
      attempts=$((attempts + 1))
      [ "$attempts" -lt 60 ] || {
        printf '%s\n' "Emulator route readiness timed out after stopping llkd." >&2
        exit 1
      }
      sleep 1
    done
    node "$repo/scripts/validation/performance-report.mjs" capture-device \
      "$state/metadata.private.json" "$ANDROID_HOME" "$serial" "$api" "$avd"
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
