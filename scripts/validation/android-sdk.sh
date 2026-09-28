# Resolves the Android SDK root into ANDROID_HOME for the validation scripts.
#
# Sourced, not executed. The scripts run under `set -eu`, so a bare
# "$ANDROID_HOME/..." expansion in an agent or CI shell that never exported it
# aborts the script at its first use with only "ANDROID_HOME: unbound variable"
# — which the caller surfaces as a generic lock/startup failure. Resolving it
# here turns a missing SDK into one named, actionable error at entry.
android_sdk_resolve() {
  sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
  [ -n "$sdk" ] || sdk="$HOME/Android/Sdk"

  if [ ! -x "$sdk/platform-tools/adb" ] || [ ! -x "$sdk/emulator/emulator" ]; then
    printf '%s\n' \
      "Android SDK not usable at '$sdk' (need platform-tools/adb and emulator/emulator)." \
      "Set ANDROID_HOME to an SDK installation with both components installed." >&2
    exit 1
  fi

  ANDROID_HOME=$sdk
  export ANDROID_HOME
}
