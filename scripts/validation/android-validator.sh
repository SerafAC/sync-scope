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
case "$api:$avd:$state" in
  31:dependency_api31:/tmp/cloud-sync-checker-api31) ;;
  36:dependency_api36:/tmp/cloud-sync-checker-api36) ;;
  *) exit 64 ;;
esac
[ "$exclusive_lock" = /tmp/cloud-sync-checker-validator.lock ] || exit 64

adb="$ANDROID_HOME/platform-tools/adb"
emulator="$ANDROID_HOME/emulator/emulator"
owner="$state/owner"
pid_file="$state/pid"
serial_file="$state/serial"
adb_server_pid_file="$state/adb-server-pid"

adb_command() {
  timeout --signal=TERM --kill-after=5 30 "$adb" "$@"
}
find_adb_server() {
  ps -eo pid=,args= | awk \
    '$2 == "adb" && $3 == "-L" && $4 == "tcp:5037" {print $1; exit}'
}

memory_ready() {
  available=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
  total=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
  [ "$available" -ge 8388608 ] && [ $((available * 100 / total)) -ge 30 ]
}
owned_running() {
  [ -f "$owner" ] && [ "$(cat "$owner")" = "$api:$avd" ] &&
    [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null
}
owned_state() {
  [ -f "$owner" ] && [ "$(cat "$owner")" = "$api:$avd" ]
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
    if owned_running && serial_ready; then exit 0; fi
    [ ! -e "$state" ] || exit 1
    memory_ready || {
      printf '%s\n' "Validator memory preflight failed." >&2
      exit 1
    }
    adb_server_before=$(find_adb_server || true)
    if adb_command devices |
      awk 'NR > 1 && $2 == "device" {found=1} END {exit !found}'; then
      printf '%s\n' "Another connected validator is active." >&2
      exit 1
    fi
    mkdir -p "$state"
    printf '%s\n' "$api:$avd" >"$owner"
    : >"$state/devices.before"
    adb_command devices |
      awk 'NR > 1 && $1 != "" {print $1}' >"$state/devices.before"
    if [ -z "$adb_server_before" ]; then
      adb_server_after=$(find_adb_server || true)
      [ -z "$adb_server_after" ] ||
        printf '%s\n' "$adb_server_after" >"$adb_server_pid_file"
    fi

    cleanup_failed_start() {
      trap - EXIT HUP INT TERM
      if [ -f "$pid_file" ]; then
        failed_pid=$(cat "$pid_file")
        kill -TERM -- "-$failed_pid" 2>/dev/null || true
        wait "$failed_pid" 2>/dev/null || true
      fi
      if [ -f "$adb_server_pid_file" ]; then
        failed_adb_pid=$(cat "$adb_server_pid_file")
        if [ -r "/proc/$failed_adb_pid/cmdline" ] &&
          tr '\0' ' ' <"/proc/$failed_adb_pid/cmdline" |
            grep -Fq 'adb -L tcp:5037'; then
          kill -TERM "$failed_adb_pid"
        fi
      fi
      rm -rf -- "$state"
      flock -n "$exclusive_lock" sh -c 'rm -f -- "$1"' \
        sh "$exclusive_lock" || true
    }
    trap cleanup_failed_start EXIT
    trap 'exit 130' HUP INT TERM

    setsid flock -n "$exclusive_lock" \
      timeout --signal=TERM --kill-after=20 2700 \
      "$emulator" -avd "$avd" -no-window -no-snapshot -no-boot-anim -no-audio \
      -gpu swiftshader_indirect -memory 2048 -no-metrics \
      >"$state/emulator.log" 2>&1 &
    pid=$!
    printf '%s\n' "$pid" >"$pid_file"

    attempts=0
    serial=
    until [ -n "$serial" ]; do
      kill -0 "$pid" 2>/dev/null || {
        printf '%s\n' "Emulator or validator lock failed to start." >&2
        exit 1
      }
      serial=$(adb_command devices | awk \
        'NR > 1 && $1 ~ /^emulator-/ && $2 == "device" {print $1; exit}')
      attempts=$((attempts + 1))
      [ "$attempts" -lt 180 ] || exit 1
      [ -n "$serial" ] || sleep 1
    done
    printf '%s\n' "$serial" >"$serial_file"

    attempts=0
    until serial_ready; do
      attempts=$((attempts + 1))
      [ "$attempts" -lt 240 ] || {
        printf '%s\n' "Emulator route readiness timed out." >&2
        exit 1
      }
      sleep 1
    done
    trap - EXIT HUP INT TERM
    ;;
  healthcheck)
    owned_running && serial_ready
    ;;
  stop)
    owned_state || {
      printf '%s\n' "Refusing to stop an unowned validator." >&2
      exit 1
    }
    if [ -f "$serial_file" ]; then
      serial=$(cat "$serial_file")
      adb_command -s "$serial" emu kill >/dev/null 2>&1 || true
    fi
    if [ -f "$pid_file" ]; then
      pid=$(cat "$pid_file")
      kill -TERM -- "-$pid" 2>/dev/null || true
      attempts=0
      while kill -0 "$pid" 2>/dev/null; do
        attempts=$((attempts + 1))
        [ "$attempts" -lt 30 ] || {
          kill -KILL -- "-$pid" 2>/dev/null || true
          break
        }
        sleep 1
      done
      wait "$pid" 2>/dev/null || true
    fi
    if [ -f "$adb_server_pid_file" ]; then
      adb_server_pid=$(cat "$adb_server_pid_file")
      if [ -r "/proc/$adb_server_pid/cmdline" ] &&
        tr '\0' ' ' <"/proc/$adb_server_pid/cmdline" |
          grep -Fq 'adb -L tcp:5037'; then
        kill -TERM "$adb_server_pid"
      fi
    fi
    rm -rf -- "$state"
    attempts=0
    while [ -e "$exclusive_lock" ]; do
      if flock -n "$exclusive_lock" sh -c 'rm -f -- "$1"' \
        sh "$exclusive_lock"; then
        break
      fi
      attempts=$((attempts + 1))
      [ "$attempts" -lt 10 ] || break
      sleep 1
    done
    ;;
  *) exit 64 ;;
esac
