#!/bin/sh
set -eu

action=${1:-}
case "$action" in start|stop|healthcheck) ;; *) exit 64 ;; esac
repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
compose="$repo/validation/services/compose.yaml"
. "$repo/scripts/validation/validation-lifecycle.sh"
# Standalone service management must not race an active full validation.
if [ -z "${SYNCSCOPE_INVOCATION_TOKEN:-}" ]; then
  invocation_lock=$(validation_state invocation.lock)
  validation_lock_safe "$invocation_lock" || exit 1
  exec 9>>"$invocation_lock"
  flock -n 9 || exit 1
fi
receipts=$(mktemp -d /tmp/cloud-sync-checker-services-XXXXXX)

run() {
  protocol=$1
  port=$2
  shift 2
  SYNCSCOPE_RESOURCE_RECEIPT="${receipt:-}" "$repo/scripts/validation/protocol-service.sh" "$action" "$protocol" \
    --compose "$compose" --project "syncscope-$protocol" \
    --host 127.0.0.1 --port "$port" "$@"
}

if [ "$action" = stop ]; then
  status=0
  run ftp 32120 --passive-ports 32200-32209 || status=1
  run webdav 32180 || status=1
  run sftp 32122 || status=1
  rm -rf -- "$receipts"
  exit "$status"
fi

if [ "$action" = healthcheck ]; then
  run sftp 32122
  run webdav 32180
  run ftp 32120 --passive-ports 32200-32209
  rm -rf -- "$receipts"
  exit 0
fi

cleanup_failed_start() {
  status=$?
  trap - EXIT HUP INT TERM
  action=stop
  # The child can acquire a resource and interrupt us before run returns.
  # Receipts, not parent-memory startup flags, authorize reverse-order cleanup.
  for protocol in ftp webdav sftp; do
    receipt="$receipts/$protocol"
    ownership=$(validation_read_receipt "$receipt") || continue
    [ "$ownership" = acquired ] || continue
    case "$protocol" in
      sftp) run sftp 32122 || true ;;
      webdav) run webdav 32180 || true ;;
      ftp) run ftp 32120 --passive-ports 32200-32209 || true ;;
    esac
  done
  rm -rf -- "$receipts"
  exit "$status"
}
trap cleanup_failed_start EXIT
trap 'exit 130' HUP INT TERM

receipt="$receipts/sftp"; run sftp 32122
receipt="$receipts/webdav"; run webdav 32180
receipt="$receipts/ftp"; run ftp 32120 --passive-ports 32200-32209
trap - EXIT HUP INT TERM
rm -rf -- "$receipts"
