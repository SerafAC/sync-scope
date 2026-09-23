#!/bin/sh
set -eu

protocol=${1:-}
log_file=${2:-}
[ -f "$log_file" ] || exit 0

# Lines that can carry a violation at all. Everything else in the log is server chatter,
# which must not be able to fail an otherwise clean run.
scope='.'
case "$protocol" in
  sftp)
    forbidden='(open .*flags (READ|WRITE)|remove name|rename old|mkdir name|rmdir name|symlink old)'
    ;;
  webdav)
    forbidden='(^|[[:space:]])(GET|PUT|DELETE|MOVE|COPY|MKCOL|PATCH|POST)([[:space:]]|$)'
    ;;
  ftp)
    forbidden='(RETR|STOR|APPE|DELE|RNFR|RNTO|MKD|RMD|PORT|EPRT)'
    # vsftpd answers FEAT by advertising its own capabilities, EPRT among them, on
    # "FTP response" lines. Only a client command line can breach the read-only contract,
    # so the scan is restricted to those; a real RETR/PORT/EPRT command still matches.
    scope='FTP command:'
    ;;
  *)
    exit 64
    ;;
esac

if grep -Eih "$scope" "$log_file" | grep -Eiq "$forbidden"; then
  printf '%s\n' "$protocol audit: prohibited content or mutation operation observed" >&2
  exit 1
fi
printf '%s\n' "$protocol audit: metadata-read operation allowlist is clean"
