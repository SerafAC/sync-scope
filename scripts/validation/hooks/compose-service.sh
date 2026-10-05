# Shared by pause-service.sh and resume-service.sh. Sourced, never run.
#
# compose_service <pause|unpause> <protocol>: runs that Compose verb on one
# protocol service, addressing the project and compose file the way
# protocol-services.sh does, with the state paths compose.yaml interpolates.
compose_service() {
  verb=$1
  protocol=${2:-}
  case "$protocol" in
    ftp|sftp|webdav) ;;
    *)
      printf '%s\n' "Protocol must be ftp, sftp or webdav." >&2
      exit 64
      ;;
  esac
  repo=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
  SYNCSCOPE_STATE_ROOT="/tmp/cloud-sync-checker-syncscope-$protocol"
  SYNCSCOPE_CREDENTIALS_FILE="$SYNCSCOPE_STATE_ROOT/credentials"
  export SYNCSCOPE_STATE_ROOT SYNCSCOPE_CREDENTIALS_FILE
  timeout 120 docker compose -p "syncscope-$protocol" \
    -f "$repo/validation/services/compose.yaml" "$verb" "$protocol"
}
