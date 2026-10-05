import type {RepositoryProtocol} from '../native/CloudSyncContracts';

/** The form fields a pasted server URL fills in; a field the URL does not mention stays absent. */
export interface ServerAddressParts {
  host: string;
  protocol?: RepositoryProtocol;
  webdavHttps?: boolean;
  /** As text, the way the Port field holds it. */
  port?: string;
  username?: string;
  remoteRoot?: string;
}

const SCHEMES: Record<string, {protocol: RepositoryProtocol; https?: boolean}> =
  {
    ftp: {protocol: 'FTP'},
    sftp: {protocol: 'SFTP'},
    ssh: {protocol: 'SFTP'},
    http: {protocol: 'WEBDAV', https: false},
    dav: {protocol: 'WEBDAV', https: false},
    webdav: {protocol: 'WEBDAV', https: false},
    https: {protocol: 'WEBDAV', https: true},
    davs: {protocol: 'WEBDAV', https: true},
    webdavs: {protocol: 'WEBDAV', https: true},
  };

// [scheme://][user[:password]@]host-or-[ipv6][:port][/path][?query][#fragment]
const ADDRESS =
  /^(?:([a-z][a-z0-9+.-]*):\/\/)?(?:([^@/?#]*)@)?(\[[^\]/]*\]|[^:/?#[\]]+)(?::(\d*))?(\/[^?#]*)?(?:[?#].*)?$/i;

// Two or more colons and nothing else: an IPv6 address, not host:port.
const BARE_IPV6 = /^[0-9a-f]*:[0-9a-f]*:[0-9a-f:.]*$/i;

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Splits a server URL typed into the Host field (`https://nas.local:8443/dav/photos`,
 * `sftp://alice@nas.local`, `nas.local/photos`) into the form's fields. Returns null when the text is
 * already a bare host name or IP address, or when it is not a URL the app can use (an unknown scheme,
 * for example); the host is then saved as typed and native validation reports any problem.
 */
export function splitServerAddress(text: string): ServerAddressParts | null {
  const trimmed = text.trim();
  if (!/[:/@]/.test(trimmed)) {
    return null;
  }
  if (!trimmed.includes('://') && BARE_IPV6.test(trimmed)) {
    return null;
  }
  const match = ADDRESS.exec(trimmed);
  if (match == null) {
    return null;
  }
  const [, scheme, userInfo, rawHost = '', port, path] = match;
  const known = scheme != null ? SCHEMES[scheme.toLowerCase()] : undefined;
  if (scheme != null && known == null) {
    return null;
  }

  const parts: ServerAddressParts = {host: rawHost.replace(/^\[|\]$/g, '')};
  if (known != null) {
    parts.protocol = known.protocol;
    if (known.https != null) {
      parts.webdavHttps = known.https;
    }
  }
  if (port != null && port !== '') {
    parts.port = port;
  }
  if (userInfo != null && userInfo !== '') {
    // A password in the URL is dropped: it belongs in the Password field only.
    parts.username = decode(userInfo.split(':')[0] ?? '');
  }
  if (path != null) {
    const folder = decode(path).replace(/\/+$/, '');
    if (folder !== '') {
      parts.remoteRoot = folder;
    }
  }
  return parts;
}
