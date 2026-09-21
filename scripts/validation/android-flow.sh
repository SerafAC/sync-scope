#!/bin/sh
set -eu

mode=${1:-}
shift || true
apis=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --api)
      case "${2:-}" in 31|36) apis="$apis ${2:-}" ;; *) exit 64 ;; esac
      shift 2
      ;;
    *) exit 64 ;;
  esac
done
case "$mode" in connected|e2e) ;; *) exit 64 ;; esac
[ -n "$apis" ] || apis=" 31"

repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
compose="$repo/validation/services/compose.yaml"
protocols_started=
active_api=
gradle_pid=
metro_started=

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ -n "$gradle_pid" ] && kill -0 "$gradle_pid" 2>/dev/null; then
    kill -TERM -- "-$gradle_pid" 2>/dev/null || true
    wait "$gradle_pid" 2>/dev/null || true
  fi
  if [ -n "$metro_started" ]; then
    "$repo/scripts/validation/metro-service.sh" stop \
      --host 127.0.0.1 --port 8081 \
      --state /tmp/cloud-sync-checker-metro || status=1
  fi
  if [ -n "$active_api" ]; then
    "$repo/scripts/validation/android-validator.sh" stop \
      --api "$active_api" --avd "dependency_api$active_api" \
      --state "/tmp/cloud-sync-checker-api$active_api" \
      --exclusive-lock /tmp/cloud-sync-checker-validator.lock || status=1
  fi
  for protocol in $protocols_started; do
    case "$protocol" in
      sftp) port=32122; passive= ;;
      webdav) port=32180; passive= ;;
      ftp) port=32120; passive='--passive-ports 32200-32209' ;;
    esac
    # shellcheck disable=SC2086
    "$repo/scripts/validation/protocol-service.sh" stop "$protocol" \
      --compose "$compose" --project "syncscope-$protocol" \
      --host 127.0.0.1 --port "$port" $passive || status=1
  done
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM

for protocol in sftp webdav ftp; do
  case "$protocol" in
    sftp) port=32122; passive= ;;
    webdav) port=32180; passive= ;;
    ftp) port=32120; passive='--passive-ports 32200-32209' ;;
  esac
  # shellcheck disable=SC2086
  "$repo/scripts/validation/protocol-service.sh" start "$protocol" \
    --compose "$compose" --project "syncscope-$protocol" \
    --host 127.0.0.1 --port "$port" $passive
  protocols_started="$protocol $protocols_started"
done

if [ "$mode" = e2e ]; then
  "$repo/scripts/validation/metro-service.sh" start \
    --host 127.0.0.1 --port 8081 \
    --state /tmp/cloud-sync-checker-metro
  metro_started=yes
fi

for api in $apis; do
  active_api=$api
  "$repo/scripts/validation/android-validator.sh" start \
    --api "$api" --avd "dependency_api$api" \
    --state "/tmp/cloud-sync-checker-api$api" \
    --exclusive-lock /tmp/cloud-sync-checker-validator.lock
  serial=$(cat "/tmp/cloud-sync-checker-api$api/serial")
  export ANDROID_SERIAL="$serial"
  export SYNCSCOPE_SFTP_CREDENTIAL_FILE=/tmp/cloud-sync-checker-syncscope-sftp/credentials
  export SYNCSCOPE_WEBDAV_CREDENTIAL_FILE=/tmp/cloud-sync-checker-syncscope-webdav/credentials
  export SYNCSCOPE_FTP_CREDENTIAL_FILE=/tmp/cloud-sync-checker-syncscope-ftp/credentials

  if [ "$mode" = connected ]; then
    setsid timeout --signal=TERM --kill-after=20 1200 \
      "$repo/android/gradlew" -p "$repo/android" --no-daemon \
      :app:connectedDebugAndroidTest &
  else
    setsid timeout --signal=TERM --kill-after=20 1200 \
      "$repo/android/gradlew" -p "$repo/android" --no-daemon \
      :app:assembleDebug &
  fi
  gradle_pid=$!
  wait "$gradle_pid"
  gradle_pid=

  if [ "$mode" = e2e ]; then
    timeout --signal=TERM --kill-after=10 60 \
      "$ANDROID_HOME/platform-tools/adb" -s "$serial" install -r \
      "$repo/android/app/build/outputs/apk/debug/app-debug.apk"
    timeout --signal=TERM --kill-after=10 600 \
      /home/adi/.cache/cloud-sync-checker-toolchain/maestro-2.10.0/maestro/bin/maestro \
      test "$repo/validation/maestro"
  fi

  "$repo/scripts/validation/android-validator.sh" stop \
    --api "$api" --avd "dependency_api$api" \
    --state "/tmp/cloud-sync-checker-api$api" \
    --exclusive-lock /tmp/cloud-sync-checker-validator.lock
  active_api=
done
