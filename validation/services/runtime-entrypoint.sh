#!/bin/sh
set -eu

credential_file=/run/secrets/fixture_credentials
[ -r "$credential_file" ] || {
  printf '%s\n' "Fixture credential secret is unavailable." >&2
  exit 1
}

username=$(sed -n 's/^username=//p' "$credential_file")
password=$(sed -n 's/^password=//p' "$credential_file")
case "$username" in
  ''|*[!a-z0-9_]*)
    printf '%s\n' "Fixture account name is invalid." >&2
    exit 1
    ;;
esac
[ -n "$password" ] || {
  printf '%s\n' "Fixture password is missing." >&2
  exit 1
}

case "${1:-}" in
  sftp)
    groupadd --system syncscope_fixture
    useradd --system --gid syncscope_fixture --home-dir /srv/fixtures \
      --shell /usr/sbin/nologin "$username"
    printf '%s:%s\n' "$username" "$password" | chpasswd
    install -d -m 0700 /run/syncscope-hostkeys
    if [ ! -f /run/syncscope-hostkeys/ssh_host_ed25519_key ]; then
      ssh-keygen -q -t ed25519 -N '' \
        -f /run/syncscope-hostkeys/ssh_host_ed25519_key
    fi
    exec /usr/sbin/sshd -D -e -f /etc/ssh/sshd_config
    ;;
  ftp)
    useradd --system --home-dir /srv/fixtures --shell /bin/sh "$username"
    printf '%s:%s\n' "$username" "$password" | chpasswd
    install -o root -g root -m 0644 /dev/null \
      /var/log/syncscope/vsftpd.log
    install -o root -g root -m 0600 \
      /opt/syncscope/vsftpd.conf /etc/syncscope-vsftpd.conf
    exec /usr/sbin/vsftpd /etc/syncscope-vsftpd.conf
    ;;
  webdav)
    /usr/local/apache2/bin/htpasswd -bBc \
      /usr/local/apache2/conf/validation.htpasswd "$username" "$password" \
      >/dev/null
    exec httpd-foreground
    ;;
  *)
    printf '%s\n' "Unknown fixture protocol." >&2
    exit 64
    ;;
esac
