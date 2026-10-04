#!/bin/sh
set -eu

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/android-sdk.sh"
android_sdk_resolve

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
case "$mode" in connected|e2e|release-smoke) ;; *) exit 64 ;; esac
[ -n "$apis" ] || apis=" 31"

repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
compose="$repo/validation/services/compose.yaml"
maestro_bin=/home/adi/.cache/cloud-sync-checker-toolchain/maestro-2.10.0/maestro/bin/maestro
hooks="$repo/scripts/validation/hooks"
# The staged flows all use the SFTP seam, so their host-side hooks act on the
# SFTP service's fixture tree. Every protocol's tree is the same seed, so the
# expected sizes are measured from it too.
staged_state=/tmp/cloud-sync-checker-syncscope-sftp
protocols_started=
active_api=
gradle_pid=
metro_started=
paused_protocols=
keystore_dir=

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  for protocol in $paused_protocols; do
    "$hooks/resume-service.sh" "$protocol" || status=1
  done
  if [ -n "$protocols_started" ]; then
    SYNCSCOPE_STATE_ROOT=$staged_state "$hooks/restore-recheck-file.sh" ||
      status=1
  fi
  if [ -n "$keystore_dir" ]; then
    rm -rf -- "$keystore_dir" || status=1
  fi
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

adb() {
  timeout --signal=TERM --kill-after=10 "${ADB_TIMEOUT:-60}" \
    "$ANDROID_HOME/platform-tools/adb" -s "$serial" "$@"
}

# size_of <fixture path>...: the byte sum of files fixture-seed.sh wrote.
size_of() {
  (cd "$staged_state/fixtures" && cat -- "$@") | wc -c | tr -d ' '
}

# run_flow <flow> <maestro -e arguments>...
run_flow() {
  flow=$1
  shift
  timeout --signal=TERM --kill-after=10 900 \
    "$maestro_bin" test "$@" "$repo/validation/maestro/$flow" </dev/null
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

# release_smoke_build: release-smoke steps 1-3 (contracts/maestro-mvp.md).
release_smoke_build() {
  # Step 1: no signing properties, so the documented failure (Story 4 sc. 4).
  gradle_properties="${GRADLE_USER_HOME:-$HOME/.gradle}/gradle.properties"
  if grep -qs '^[[:space:]]*SYNCSCOPE_RELEASE_' "$gradle_properties"; then
    printf '%s\n' \
      "$gradle_properties sets SYNCSCOPE_RELEASE_* properties; release-smoke needs them unset." >&2
    exit 1
  fi
  if unsigned=$(cd "$repo" && env \
    -u ORG_GRADLE_PROJECT_SYNCSCOPE_RELEASE_STORE_FILE \
    -u ORG_GRADLE_PROJECT_SYNCSCOPE_RELEASE_STORE_PASSWORD \
    -u ORG_GRADLE_PROJECT_SYNCSCOPE_RELEASE_KEY_ALIAS \
    -u ORG_GRADLE_PROJECT_SYNCSCOPE_RELEASE_KEY_PASSWORD \
    timeout --signal=TERM --kill-after=20 1200 pnpm assemble:release 2>&1); then
    printf '%s\n' "The release build without signing properties must fail." >&2
    exit 1
  fi
  case "$unsigned" in
    *"Release signing is not configured"*) ;;
    *)
      printf '%s\n' "$unsigned" >&2
      printf '%s\n' "The unsigned release build failed without the signing message." >&2
      exit 1
      ;;
  esac

  # Step 2: a throwaway key, then the documented command (sc. 3).
  keystore_dir=$(mktemp -d /tmp/cloud-sync-checker-release-XXXXXX)
  keystore_secret=$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')
  "${JAVA_HOME:+$JAVA_HOME/bin/}keytool" -genkeypair -noprompt \
    -storetype PKCS12 -keystore "$keystore_dir/release.p12" \
    -alias syncscope-release-smoke -keyalg RSA -keysize 2048 -validity 1 \
    -dname 'CN=SyncScope release smoke' \
    -storepass "$keystore_secret" -keypass "$keystore_secret" >/dev/null 2>&1
  export ORG_GRADLE_PROJECT_SYNCSCOPE_RELEASE_STORE_FILE="$keystore_dir/release.p12"
  export ORG_GRADLE_PROJECT_SYNCSCOPE_RELEASE_STORE_PASSWORD="$keystore_secret"
  export ORG_GRADLE_PROJECT_SYNCSCOPE_RELEASE_KEY_ALIAS=syncscope-release-smoke
  export ORG_GRADLE_PROJECT_SYNCSCOPE_RELEASE_KEY_PASSWORD="$keystore_secret"
  (cd "$repo" && timeout --signal=TERM --kill-after=20 1200 pnpm assemble:release)
  keystore_secret=

  # Step 3: the APK's version comes from package.json (FR-022, R17).
  version=$(node -p "require(process.argv[1]).version" "$repo/package.json")
  printf '%s\n' "$version" |
    grep -Eqx '(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)' || {
    printf 'package.json version is not MAJOR.MINOR.PATCH: %s\n' "$version" >&2
    exit 1
  }
  major=${version%%.*}
  minor=${version#*.}
  minor=${minor%%.*}
  patch=${version##*.}
  version_code=$((major * 10000 + minor * 100 + patch))
  aapt2=$(ls -d "$ANDROID_HOME"/build-tools/*/aapt2 | sort -V | tail -n 1)
  badging=$("$aapt2" dump badging "$release_apk" | sed -n '1p')
  case "$badging" in
    *" versionCode='$version_code'"*" versionName='$version'"*) ;;
    *)
      printf 'Release APK version does not match package.json %s (code %s): %s\n' \
        "$version" "$version_code" "$badging" >&2
      exit 1
      ;;
  esac
}

release_apk="$repo/android/app/build/outputs/apk/release/app-release.apk"
if [ "$mode" = release-smoke ]; then
  release_smoke_build
fi

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
    gradle_pid=$!
  elif [ "$mode" = e2e ]; then
    setsid timeout --signal=TERM --kill-after=20 1200 \
      "$repo/android/gradlew" -p "$repo/android" --no-daemon \
      :app:assembleDebug &
    gradle_pid=$!
  fi
  if [ -n "$gradle_pid" ]; then
    wait "$gradle_pid"
    gradle_pid=
  fi

  if [ "$mode" = release-smoke ]; then
    # Step 4: a clean install of the release APK, with Metro never started.
    adb uninstall com.syncscope >/dev/null 2>&1 || true
    adb install "$release_apk"
  elif [ "$mode" = e2e ]; then
    debug_apk="$repo/android/app/build/outputs/apk/debug/app-debug.apk"
    # A release-smoke run leaves the release-signed APK installed, and Android
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
  if [ "$mode" != connected ]; then
    "$repo/scripts/validation/device-fixtures.sh"
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

    if [ "$mode" = e2e ]; then
      # The whole workspace (003's sources flows and 004's scan flows, run in
      # order with fresh app state per scan flow) takes well over 10 minutes.
      timeout --signal=TERM --kill-after=10 2400 \
        "$maestro_bin" \
        test "$@" "$repo/validation/maestro"
      # Staged pairs: flows that change server or device state mid-scenario.
      run_staged_pairs "$@"
      SYNCSCOPE_STATE_ROOT=$staged_state "$hooks/restore-recheck-file.sh"
    else
      # Step 5: the debug-only configure deep link does not exist in release.
      started=$(adb shell am start -W -a android.intent.action.VIEW \
        -d 'syncscope-debug://configure-repository' 2>&1 || true)
      case "$started" in
        *"Error: Activity not started, unable to resolve Intent"*) ;;
        *)
          printf '%s\n' "$started" >&2
          printf '%s\n' "The release APK resolves the debug configure deep link." >&2
          exit 1
          ;;
      esac
      # Steps 6-7: the smoke flow, then an in-place update with the same key.
      run_flow mvp/90-release-smoke.yaml "$@"
      adb install -r "$release_apk"
      run_flow mvp/91-release-update.yaml "$@"
    fi
  fi

  "$repo/scripts/validation/android-validator.sh" stop \
    --api "$api" --avd "dependency_api$api" \
    --state "/tmp/cloud-sync-checker-api$api" \
    --exclusive-lock /tmp/cloud-sync-checker-validator.lock
  active_api=
done
