#!/bin/sh
set -eu

action=${1:-}
protocol=${2:-}
[ "$#" -ge 2 ] && shift 2 || true
compose=
project=
host=
port=
passive_ports=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --compose) compose=${2:-}; shift 2 ;;
    --project) project=${2:-}; shift 2 ;;
    --host) host=${2:-}; shift 2 ;;
    --port) port=${2:-}; shift 2 ;;
    --passive-ports) passive_ports=${2:-}; shift 2 ;;
    *) exit 64 ;;
  esac
done

case "$protocol:$host:$port:$passive_ports" in
  sftp:127.0.0.1:32122:) ;;
  webdav:127.0.0.1:32180:) ;;
  ftp:127.0.0.1:32120:32200-32209) ;;
  *) printf '%s\n' "Protocol endpoint is not approved." >&2; exit 64 ;;
esac
case "$project" in syncscope-sftp|syncscope-webdav|syncscope-ftp) ;; *) exit 64 ;; esac
[ -f "$compose" ] || exit 1

repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
. "$repo/scripts/validation/validation-lifecycle.sh"
state=$(validation_state "$project")
credentials="$state/credentials"
owner="$state/owner"
export SYNCSCOPE_STATE_ROOT="$state"
export SYNCSCOPE_CREDENTIALS_FILE="$credentials"

compose_command() {
  if [ -f "$state/claim.compose.yaml" ]; then
    timeout 120 docker compose -p "$project" -f "$compose" -f "$state/claim.compose.yaml" "$@"
    return
  fi
  timeout 120 docker compose -p "$project" -f "$compose" "$@"
}

port_is_listening() {
  ss -H -ltn "sport = :$1" | grep -q .
}

healthcheck() {
  [ -f "$owner" ] && [ "$(cat "$owner")" = "$project:$protocol" ] || return 1
  compose_command ps --status running --services | grep -qx "$protocol" || return 1
  port_is_listening "$port" || return 1
  if [ "$protocol" = ftp ]; then
    passive=32200
    while [ "$passive" -le 32209 ]; do
      compose_command port "$protocol" "$passive" |
        grep -Eq "^127\\.0\\.0\\.1:$passive$" || return 1
      passive=$((passive + 1))
    done
  fi
}
scope_begin() {
  [ -n "${SYNCSCOPE_RESOURCE_RECEIPT:-}" ] || return 0
  date -u '+%Y-%m-%dT%H:%M:%SZ' >"$SYNCSCOPE_RESOURCE_RECEIPT.since"
  compose_command ps -a -q "$protocol" >"$SYNCSCOPE_RESOURCE_RECEIPT.containers"
  node "$repo/scripts/validation/fixture-manifest.mjs" "$state/fixtures" \
    >"$SYNCSCOPE_RESOURCE_RECEIPT.manifest"
  offset=0
  [ ! -f "$state/audit/vsftpd.log" ] || offset=$(wc -c <"$state/audit/vsftpd.log")
  printf '%s\n' "$offset" >"$SYNCSCOPE_RESOURCE_RECEIPT.offset"
}
audit() {
  audit_log="$state/audit.log"
  if [ -n "${SYNCSCOPE_RESOURCE_RECEIPT:-}" ]; then
    [ -f "$SYNCSCOPE_RESOURCE_RECEIPT.since" ] || return 1
    containers=$(compose_command ps -a -q "$protocol")
    [ "$containers" = "$(cat "$SYNCSCOPE_RESOURCE_RECEIPT.containers")" ] || return 1
    audit_log="$SYNCSCOPE_RESOURCE_RECEIPT.audit.private"
    compose_command logs --no-color --since "$(cat "$SYNCSCOPE_RESOURCE_RECEIPT.since")" "$protocol" >"$audit_log" 2>&1 || return 1
    if [ "$protocol" = ftp ] && [ -f "$state/audit/vsftpd.log" ]; then
      offset=$(cat "$SYNCSCOPE_RESOURCE_RECEIPT.offset")
      # Byte offset scopes the FTP file audit without copying prior run entries.
      dd if="$state/audit/vsftpd.log" bs=1 skip="$offset" status=none >>"$audit_log" || return 1
    fi
    node "$repo/scripts/validation/fixture-manifest.mjs" "$state/fixtures" \
      >"$SYNCSCOPE_RESOURCE_RECEIPT.after.manifest" || return 1
    cmp "$SYNCSCOPE_RESOURCE_RECEIPT.manifest" "$SYNCSCOPE_RESOURCE_RECEIPT.after.manifest" >/dev/null || return 1
  else
    compose_command logs --no-color "$protocol" >"$audit_log" 2>&1 || return 1
    if [ "$protocol" = ftp ] && [ -f "$state/audit/vsftpd.log" ]; then
      cat "$state/audit/vsftpd.log" >>"$audit_log" || return 1
    fi
  fi
  "$repo/scripts/validation/protocol-audit.sh" "$protocol" "$audit_log" || return 1
  "$repo/scripts/validation/fixture-manifest.sh" \
    --protocol "$protocol" --phase after --state "$state"
}
release_containers() {
  # A project marker alone does not own new containers in that project. Only
  # containers carrying this acquisition's label may be removed, including
  # partially-created containers after failed `up`.
  release_status=0
  containers=$(compose_command ps -a -q "$protocol") || return 1
  for container in $containers; do
    case "$container" in *[!a-f0-9]*|'') return 1 ;; esac
    [ "${#container}" -ge 12 ] && [ "${#container}" -le 64 ] || return 1
    claim=$(timeout 30 docker inspect --format '{{ index .Config.Labels "syncscope.invocation" }}' "$container") || return 1
    [ -f "$state/claim" ] && [ "$claim" = "$(cat "$state/claim")" ] || return 1
    timeout 120 docker rm -f "$container" || release_status=1
  done
  return "$release_status"
}

case "$action" in
  start)
    service_allocated=no
    cleanup_failed_start() {
      status=$?
      trap - EXIT HUP INT TERM
      validation_phase_end "$status" || true
      if [ "$service_allocated" = yes ]; then
        release_containers >/dev/null 2>&1 || {
          validation_receipt released
          exit "$status"
        }
        rm -rf -- "$state"
      fi
      validation_receipt released
      exit "$status"
    }
    trap cleanup_failed_start EXIT
    trap 'exit 130' HUP INT TERM
    validation_phase_begin shared services
    docker_version=$(docker version --format '{{.Client.Version}} {{.Server.Version}}')
    # Any Docker 29 patch/minor release is accepted; a new major needs a deliberate bump.
    case "$docker_version" in
      "29."*" 29."*) ;;
      *) printf '%s\n' "Docker 29.x is required." >&2; exit 1 ;;
    esac
    [ "$(docker compose version --short)" = "5.5.1" ] ||
      { printf '%s\n' "Compose 5.5.1 is required." >&2; exit 1; }
    if healthcheck 2>/dev/null; then
      scope_begin
      validation_receipt borrowed
      validation_phase_end 0
      trap - EXIT HUP INT TERM
      exit 0
    fi
    [ ! -e "$state" ] || {
      printf '%s\n' "Owned service state already exists but is not healthy." >&2
      exit 1
    }
    port_is_listening "$port" && {
      printf '%s\n' "Approved service port is occupied." >&2
      exit 1
    }
    if [ "$protocol" = ftp ]; then
      passive=32200
      while [ "$passive" -le 32209 ]; do
        port_is_listening "$passive" && {
          printf '%s\n' "Approved FTP passive port is occupied." >&2
          exit 1
        }
        passive=$((passive + 1))
      done
    fi
    [ -z "$(compose_command ps -a -q "$protocol")" ] || {
      printf '%s\n' "Refusing to acquire an existing unowned container." >&2
      exit 1
    }

    umask 077
    mkdir "$state"
    service_allocated=yes
    mkdir -p "$state/fixtures" "$state/host-keys" "$state/audit"
    printf '%s\n' "$project:$protocol" >"$owner"
    [ -n "${SYNCSCOPE_INVOCATION_TOKEN:-}" ] ||
      SYNCSCOPE_INVOCATION_TOKEN=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
    validation_mark_claim "$state"
    printf 'services:\n  %s:\n    labels:\n      syncscope.invocation: "%s"\n' \
      "$protocol" "$SYNCSCOPE_INVOCATION_TOKEN" >"$state/claim.compose.yaml"
    printf 'username=syncscope_' >"$credentials"
    od -An -N6 -tx1 /dev/urandom | tr -d ' \n' >>"$credentials"
    printf '\npassword=' >>"$credentials"
    od -An -N24 -tx1 /dev/urandom | tr -d ' \n' >>"$credentials"
    printf '\n' >>"$credentials"
    chmod 0600 "$credentials"
    validation_phase_end 0
    validation_phase_begin shared remote-fixtures
    "$repo/scripts/validation/fixture-seed.sh" --root "$state/fixtures"
    "$repo/scripts/validation/fixture-manifest.sh" \
      --protocol "$protocol" --phase before --state "$state"
    validation_phase_end 0
    validation_phase_begin shared services

    compose_command up -d --no-build "$protocol"
    attempts=0
    until healthcheck; do
      attempts=$((attempts + 1))
      [ "$attempts" -lt 30 ] || {
        printf '%s\n' "Protocol service did not become healthy." >&2
        exit 1
      }
      sleep 1
    done
    sleep 2
    healthcheck || {
      printf '%s\n' "Protocol service did not remain healthy." >&2
      exit 1
    }
    scope_begin
    validation_receipt acquired
    validation_phase_end 0
    trap - EXIT HUP INT TERM
    ;;
  healthcheck)
    healthcheck
    ;;
  audit)
    healthcheck
    audit
    ;;
  stop)
    if [ ! -e "$state" ]; then
      # Nothing of ours is left: android-flow.sh stops the services it started and removes
      # their state, so the gate's trailing `validation:services:stop` finds a clean host.
      # A guard against tearing down someone else's project must not turn an
      # already-clean environment into a failure, but a project still running without our
      # state really is unowned and is still refused.
      if compose_command ps --status running --services 2>/dev/null |
        grep -qx "$protocol"; then
        printf '%s\n' "Refusing to stop an unowned Compose project." >&2
        exit 1
      fi
      exit 0
    fi
    [ -f "$owner" ] && [ "$(cat "$owner")" = "$project:$protocol" ] &&
      validation_claim_matches "$state" || {
      printf '%s\n' "Refusing to stop an unowned Compose project." >&2
      exit 1
    }
    status=0
    audit || status=1
    release_containers || exit 1
    rm -rf -- "$state"
    validation_receipt released
    exit "$status"
    ;;
  *)
    exit 64
    ;;
esac
