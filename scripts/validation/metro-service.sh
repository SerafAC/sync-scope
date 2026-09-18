#!/bin/sh
set -eu

action=${1:-}
shift || true
host=
port=
state=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --host) host=${2:-}; shift 2 ;;
    --port) port=${2:-}; shift 2 ;;
    --state) state=${2:-}; shift 2 ;;
    *) exit 64 ;;
  esac
done
[ "$host:$port" = "127.0.0.1:8081" ] || exit 64
case "$state" in /tmp/cloud-sync-checker-*) ;; *) exit 64 ;; esac

owner="$state/owner"
pid_file="$state/pid"
port_is_listening() {
  ss -H -ltn "sport = :8081" | grep -q .
}
owned_running() {
  [ -f "$owner" ] && [ "$(cat "$owner")" = metro ] &&
    [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null
}

case "$action" in
  start)
    if owned_running && port_is_listening; then exit 0; fi
    [ ! -e "$state" ] || exit 1
    port_is_listening && {
      printf '%s\n' "Metro port is occupied by an unowned process." >&2
      exit 1
    }
    mkdir -p "$state"
    printf '%s\n' metro >"$owner"
    cleanup_failed_start() {
      if [ -f "$pid_file" ]; then
        failed_pid=$(cat "$pid_file")
        kill -TERM -- "-$failed_pid" 2>/dev/null || true
        wait "$failed_pid" 2>/dev/null || true
      fi
      rm -rf -- "$state"
    }
    trap cleanup_failed_start EXIT
    trap 'exit 130' HUP INT TERM
    setsid timeout --signal=TERM --kill-after=10 3600 \
      pnpm start -- --host "$host" --port "$port" \
      >"$state/metro.log" 2>&1 &
    pid=$!
    printf '%s\n' "$pid" >"$pid_file"
    attempts=0
    until owned_running && port_is_listening; do
      attempts=$((attempts + 1))
      [ "$attempts" -lt 60 ] || {
        kill -TERM -- "-$pid" 2>/dev/null || true
        wait "$pid" 2>/dev/null || true
        rm -rf -- "$state"
        printf '%s\n' "Metro did not become healthy." >&2
        exit 1
      }
      sleep 1
    done
    trap - EXIT HUP INT TERM
    ;;
  healthcheck)
    owned_running && port_is_listening
    ;;
  stop)
    owned_running || {
      printf '%s\n' "Refusing to stop an unowned Metro process." >&2
      exit 1
    }
    pid=$(cat "$pid_file")
    kill -TERM -- "-$pid"
    attempts=0
    while kill -0 "$pid" 2>/dev/null; do
      attempts=$((attempts + 1))
      [ "$attempts" -lt 20 ] || {
        kill -KILL -- "-$pid"
        break
      }
      sleep 1
    done
    wait "$pid" 2>/dev/null || true
    rm -rf -- "$state"
    ;;
  *) exit 64 ;;
esac
