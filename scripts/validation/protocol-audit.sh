#!/bin/sh
set -eu

protocol=${1:-}
log_file=${2:-}
[ -f "$log_file" ] || exit 0

case "$protocol" in
  sftp)
    forbidden='(open .*flags (READ|WRITE)|remove name|rename old|mkdir name|rmdir name|symlink old)'
    ;;
  webdav)
    forbidden='(^|[[:space:]])(GET|PUT|DELETE|MOVE|COPY|MKCOL|PATCH|POST)([[:space:]]|$)'
    ;;
  ftp)
    forbidden='(RETR|STOR|APPE|DELE|RNFR|RNTO|MKD|RMD|PORT|EPRT)'
    ;;
  *)
    exit 64
    ;;
esac

if grep -Eiq "$forbidden" "$log_file"; then
  printf '%s\n' "$protocol audit: prohibited content or mutation operation observed" >&2
  exit 1
fi
printf '%s\n' "$protocol audit: metadata-read operation allowlist is clean"
