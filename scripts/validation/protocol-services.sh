#!/bin/sh
set -eu

action=${1:-}
case "$action" in start|stop|healthcheck) ;; *) exit 64 ;; esac
repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
compose="$repo/validation/services/compose.yaml"

run() {
  protocol=$1
  port=$2
  shift 2
  "$repo/scripts/validation/protocol-service.sh" "$action" "$protocol" \
    --compose "$compose" --project "syncscope-$protocol" \
    --host 127.0.0.1 --port "$port" "$@"
}

if [ "$action" = stop ]; then
  status=0
  run ftp 32120 --passive-ports 32200-32209 || status=1
  run webdav 32180 || status=1
  run sftp 32122 || status=1
  exit "$status"
fi

if [ "$action" = healthcheck ]; then
  run sftp 32122
  run webdav 32180
  run ftp 32120 --passive-ports 32200-32209
  exit 0
fi

started=
cleanup_failed_start() {
  status=$?
  trap - EXIT HUP INT TERM
  action=stop
  for protocol in $started; do
    case "$protocol" in
      sftp) run sftp 32122 || true ;;
      webdav) run webdav 32180 || true ;;
      ftp) run ftp 32120 --passive-ports 32200-32209 || true ;;
    esac
  done
  exit "$status"
}
trap cleanup_failed_start EXIT
trap 'exit 130' HUP INT TERM

run sftp 32122
started="sftp $started"
run webdav 32180
started="webdav $started"
run ftp 32120 --passive-ports 32200-32209
started="ftp $started"
trap - EXIT HUP INT TERM
