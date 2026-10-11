# Shared private lifecycle primitives. Default scratch paths remain compatible;
# tests supply a disposable scratch root, never rewrite hardcoded host state.
umask 077
validation_state() {
  case "${SYNCSCOPE_VALIDATION_STATE_DIR:-}" in
    '') printf '/tmp/cloud-sync-checker-%s\n' "$1" ;;
    /tmp/cloud-sync-checker-*)
      [ -d "$SYNCSCOPE_VALIDATION_STATE_DIR" ] &&
        [ ! -L "$SYNCSCOPE_VALIDATION_STATE_DIR" ] &&
        [ "$(realpath -- "$SYNCSCOPE_VALIDATION_STATE_DIR")" = "$SYNCSCOPE_VALIDATION_STATE_DIR" ] &&
        [ "$(stat -c %u "$SYNCSCOPE_VALIDATION_STATE_DIR")" = "$(id -u)" ] || return 1
      printf '%s/%s\n' "$SYNCSCOPE_VALIDATION_STATE_DIR" "$1"
      ;;
    *) return 64 ;;
  esac
}
validation_lock_safe() {
  if [ -e "$1" ] || [ -L "$1" ]; then
    [ -f "$1" ] && [ ! -L "$1" ] && [ "$(stat -c %u "$1")" = "$(id -u)" ]
  else
    (set -C; : >"$1")
  fi
}
validation_receipt() {
  case "$1" in acquired|borrowed|released) ;; *) return 64 ;; esac
  [ -z "${SYNCSCOPE_RESOURCE_RECEIPT:-}" ] ||
    printf '%s\n' "$1" >"$SYNCSCOPE_RESOURCE_RECEIPT"
}
validation_read_receipt() {
  # Receipts are private handoff evidence, not shell input. Reject symlinks,
  # foreign owners, partial writes and extra lines (including trailing blanks).
  [ -f "$1" ] && [ ! -L "$1" ] &&
    [ "$(stat -c %u "$1")" = "$(id -u)" ] &&
    [ "$(wc -c <"$1")" -eq 9 ] || return 1
  receipt_value=$(cat "$1") || return 1
  case "$receipt_value" in acquired|borrowed|released) printf '%s\n' "$receipt_value" ;; *) return 1 ;; esac
}
validation_identity() {
  [ -r "/proc/$1/stat" ] && [ -r "/proc/$1/cmdline" ] || return 1
  # Strip comm (which may contain spaces) before reading starttime.
  start=$(sed 's/.*) //' "/proc/$1/stat" | awk '{print $20}')
  # starttime survives exec but changes on PID reuse. The process group also
  # has to be our session leader before any group signal is sent.
  printf '%s\n' "$start"
}
validation_save_pid() {
  printf '%s\n' "$1" >"$2/pid"
  validation_identity "$1" >"$2/process-identity"
}
validation_process_matches() {
  [ -f "$1/pid" ] && [ -f "$1/process-identity" ] || return 1
  checked_pid=$(cat "$1/pid")
  case "$checked_pid" in ''|*[!0-9]*) return 1 ;; esac
  [ "$(sed 's/.*) //' "/proc/$checked_pid/stat" 2>/dev/null | awk '{print $1}')" != Z ] || return 1
  current_identity=$(validation_identity "$checked_pid") || return 1
  [ -n "$current_identity" ] && [ "$current_identity" = "$(cat "$1/process-identity")" ]
}
validation_process_owned() {
  validation_process_matches "$1" &&
    [ "$(ps -o pgid= -p "$checked_pid" | tr -d ' ')" = "$checked_pid" ]
}
validation_stop_process() {
  validation_process_matches "$1" || return 1
  stopped_pid=$(cat "$1/pid")
  signal_target=$stopped_pid
  [ "$(ps -o pgid= -p "$stopped_pid" | tr -d ' ')" != "$stopped_pid" ] || signal_target="-$stopped_pid"
  kill -TERM -- "$signal_target" 2>/dev/null || true
  attempts=0
  while validation_process_matches "$1"; do
    attempts=$((attempts + 1))
    [ "$attempts" -lt 30 ] || {
      kill -KILL -- "$signal_target" 2>/dev/null || true
      break
    }
    sleep 1
  done
  wait "$stopped_pid" 2>/dev/null || true
}
validation_claim_matches() {
  [ -z "${SYNCSCOPE_INVOCATION_TOKEN:-}" ] ||
    { [ -f "$1/claim" ] && [ "$(cat "$1/claim")" = "$SYNCSCOPE_INVOCATION_TOKEN" ]; }
}
validation_mark_claim() {
  printf '%s\n' "${SYNCSCOPE_INVOCATION_TOKEN:-standalone}" >"$1/claim"
}
validation_now() {
  node "$repo/scripts/validation/performance-report.mjs" clock
}
validation_phase_begin() {
  [ -n "${SYNCSCOPE_PERFORMANCE_DIR:-}" ] || return 0
  phase_scope=$1
  phase_name=$2
  phase_start=$(validation_now)
}
validation_phase_end() {
  [ -n "${phase_start:-}" ] || return 0
  phase_finish=$(validation_now)
  node "$repo/scripts/validation/performance-report.mjs" segment \
    "$SYNCSCOPE_PERFORMANCE_DIR" "$phase_scope" "$phase_name" \
    "$phase_start" "$phase_finish" "$1"
  phase_start=
}
