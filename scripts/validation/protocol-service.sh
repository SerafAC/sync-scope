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
state="/tmp/cloud-sync-checker-$project"
credentials="$state/credentials"
owner="$state/owner"
export SYNCSCOPE_STATE_ROOT="$state"
export SYNCSCOPE_CREDENTIALS_FILE="$credentials"

compose_command() {
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

case "$action" in
  start)
    docker_version=$(docker version --format '{{.Client.Version}} {{.Server.Version}}')
    [ "$docker_version" = "29.7.2 29.7.2" ] ||
      { printf '%s\n' "Docker 29.7.2 is required." >&2; exit 1; }
    [ "$(docker compose version --short)" = "5.5.1" ] ||
      { printf '%s\n' "Compose 5.5.1 is required." >&2; exit 1; }
    if healthcheck 2>/dev/null; then
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

    umask 077
    mkdir -p "$state/fixtures" "$state/host-keys" "$state/audit"
    printf '%s\n' "$project:$protocol" >"$owner"
    printf 'username=syncscope_' >"$credentials"
    od -An -N6 -tx1 /dev/urandom | tr -d ' \n' >>"$credentials"
    printf '\npassword=' >>"$credentials"
    od -An -N24 -tx1 /dev/urandom | tr -d ' \n' >>"$credentials"
    printf '\n' >>"$credentials"
    chmod 0600 "$credentials"
    "$repo/scripts/validation/fixture-seed.sh" --root "$state/fixtures"
    "$repo/scripts/validation/fixture-manifest.sh" \
      --protocol "$protocol" --phase before --state "$state"

    cleanup_failed_start() {
      compose_command down --remove-orphans >/dev/null 2>&1 || true
      rm -rf -- "$state"
    }
    trap cleanup_failed_start EXIT
    trap 'exit 130' HUP INT TERM
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
    trap - EXIT HUP INT TERM
    ;;
  healthcheck)
    healthcheck
    ;;
  stop)
    [ -f "$owner" ] && [ "$(cat "$owner")" = "$project:$protocol" ] || {
      printf '%s\n' "Refusing to stop an unowned Compose project." >&2
      exit 1
    }
    status=0
    compose_command logs --no-color "$protocol" >"$state/audit.log" 2>&1 || status=1
    if [ "$protocol" = ftp ] && [ -f "$state/audit/vsftpd.log" ]; then
      cat "$state/audit/vsftpd.log" >>"$state/audit.log" || status=1
    fi
    "$repo/scripts/validation/protocol-audit.sh" \
      "$protocol" "$state/audit.log" || status=1
    "$repo/scripts/validation/fixture-manifest.sh" \
      --protocol "$protocol" --phase after --state "$state" || status=1
    compose_command down --remove-orphans || status=1
    rm -rf -- "$state"
    exit "$status"
    ;;
  *)
    exit 64
    ;;
esac
