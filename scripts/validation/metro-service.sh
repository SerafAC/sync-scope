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
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/validation-lifecycle.sh"
[ "$state" = "$(validation_state metro)" ] || exit 64

owner="$state/owner"
pid_file="$state/pid"
port_is_listening() {
  ss -H -ltn "sport = :8081" | grep -q .
}
owned_running() {
  [ -f "$owner" ] && [ "$(cat "$owner")" = metro ] &&
    validation_process_owned "$state"
}
expired_owned() {
  # Expiration is not a running-process identity match. Require the original
  # invocation's acquired receipt and claim, then prove there is nobody to
  # signal: neither the saved PID (including reuse) nor its session nor port.
  [ -n "${SYNCSCOPE_INVOCATION_TOKEN:-}" ] &&
    [ "$(validation_read_receipt "${SYNCSCOPE_RESOURCE_RECEIPT:-}")" = acquired ] &&
    [ -d "$state" ] && [ ! -L "$state" ] &&
    [ "$(stat -c %u "$state")" = "$(id -u)" ] || return 1
  for saved in owner claim pid process-identity; do
    [ -f "$state/$saved" ] && [ ! -L "$state/$saved" ] &&
      [ "$(stat -c %u "$state/$saved")" = "$(id -u)" ] || return 1
  done
  [ "$(cat "$owner")" = metro ] && validation_claim_matches "$state" || return 1
  expired_pid=$(cat "$pid_file")
  expired_identity=$(cat "$state/process-identity")
  case "$expired_pid:$expired_identity" in *[!0-9:]*|:*|*:) return 1 ;; esac
  [ "$expired_pid" -gt 1 ] && [ ! -e "/proc/$expired_pid" ] || return 1
  # Check tool failures explicitly; a failed ss/ps must not establish absence.
  expired_sockets=$(ss -H -ltn "sport = :8081") || return 1
  [ -z "$expired_sockets" ] || return 1
  expired_groups=$(ps -eo pgid=) || return 1
  if printf '%s\n' "$expired_groups" | grep -qw "$expired_pid"; then return 1; fi
  if [ -e "$state/metro.log" ] || [ -L "$state/metro.log" ]; then
    [ -f "$state/metro.log" ] && [ ! -L "$state/metro.log" ] &&
      [ "$(stat -c %u "$state/metro.log")" = "$(id -u)" ] || return 1
  fi
}

case "$action" in
  start)
    if owned_running && port_is_listening; then validation_receipt borrowed; exit 0; fi
    [ ! -e "$state" ] || exit 1
    port_is_listening && {
      printf '%s\n' "Metro port is occupied by an unowned process." >&2
      exit 1
    }
    mkdir "$state"
    cleanup_failed_start() {
      status=$?
      trap - EXIT HUP INT TERM
      validation_stop_process "$state" || true
      if [ -n "${SYNCSCOPE_PERFORMANCE_DIR:-}" ] && [ -f "$state/metro.log" ]; then
        cp "$state/metro.log" "$SYNCSCOPE_PERFORMANCE_DIR/raw/metro.log"
      fi
      rm -rf -- "$state"
      validation_receipt released
      exit "$status"
    }
    trap cleanup_failed_start EXIT
    trap 'exit 130' HUP INT TERM
    printf '%s\n' metro >"$owner"
    validation_mark_claim "$state"
    # One Metro serves every API in the e2e run (API 31 and API 36, about an
    # hour each with 006's flows), so the cap covers both passes.
    setsid timeout --signal=TERM --kill-after=10 14400 \
      pnpm start -- --host "$host" --port "$port" \
      >"$state/metro.log" 2>&1 9>&- &
    pid=$!
    validation_save_pid "$pid" "$state"
    sleep 1
    attempts=0
    until owned_running && port_is_listening; do
      attempts=$((attempts + 1))
      [ "$attempts" -lt 60 ] || {
        printf '%s\n' "Metro did not become healthy." >&2
        exit 1
      }
      sleep 1
    done
    validation_receipt acquired
    trap - EXIT HUP INT TERM
    ;;
  healthcheck)
    owned_running && port_is_listening
    ;;
  stop)
    if owned_running && validation_claim_matches "$state"; then
      validation_stop_process "$state"
    elif expired_owned; then
      : # Retain diagnostics and release scratch state, without any signal.
    else
      printf '%s\n' "Refusing to stop an unowned Metro process." >&2
      exit 1
    fi
    if [ -n "${SYNCSCOPE_PERFORMANCE_DIR:-}" ] && [ -f "$state/metro.log" ]; then
      cp "$state/metro.log" "$SYNCSCOPE_PERFORMANCE_DIR/raw/metro.log"
    fi
    rm -rf -- "$state"
    validation_receipt released
    ;;
  *) exit 64 ;;
esac
