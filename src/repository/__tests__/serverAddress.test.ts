import { splitServerAddress, withFirstRemoteRoot } from '../serverAddress';

describe('splitServerAddress', () => {
  it.each([
    'nas.local',
    '192.168.1.10',
    ' nas.local ',
    'fe80::1',
    '2001:db8::7',
  ])('leaves the bare host %p alone', host => {
    expect(splitServerAddress(host)).toBeNull();
  });

  it('keeps the shared WebDAV path in Host while splitting scheme and port', () => {
    expect(
      splitServerAddress(
        'https://cloud.example.com:8443/remote.php/dav/files/me/',
      ),
    ).toEqual({
      host: 'cloud.example.com/remote.php/dav/files/me',
      protocol: 'WEBDAV',
      webdavHttps: true,
      port: '8443',
    });
  });

  it('keeps scheme-less WebDAV paths encoded and leaves FTP folder parsing unchanged', () => {
    expect(
      splitServerAddress('nas.local/dav/Photos%20Backup/', 'WEBDAV'),
    ).toEqual({
      host: 'nas.local/dav/Photos%20Backup',
    });
    expect(splitServerAddress('ftp://nas.local/photos', 'WEBDAV')).toEqual({
      host: 'nas.local',
      protocol: 'FTP',
      remoteRoot: '/photos',
    });
  });

  it('maps each supported scheme to its protocol', () => {
    expect(splitServerAddress('http://nas')).toEqual({
      host: 'nas',
      protocol: 'WEBDAV',
      webdavHttps: false,
    });
    expect(splitServerAddress('ftp://nas')).toEqual({
      host: 'nas',
      protocol: 'FTP',
    });
    expect(splitServerAddress('SFTP://nas')).toEqual({
      host: 'nas',
      protocol: 'SFTP',
    });
    expect(splitServerAddress('davs://nas')?.webdavHttps).toBe(true);
  });

  it('takes the user name but never the password from the URL', () => {
    expect(splitServerAddress('sftp://alice%40home:secret@nas.local')).toEqual({
      host: 'nas.local',
      protocol: 'SFTP',
      username: 'alice@home',
    });
  });

  it('splits host:port and host/path without a scheme, keeping the protocol', () => {
    expect(splitServerAddress('nas.local:2222')).toEqual({
      host: 'nas.local',
      port: '2222',
    });
    expect(splitServerAddress('nas.local/Photos%20Backup')).toEqual({
      host: 'nas.local',
      remoteRoot: '/Photos Backup',
    });
  });

  it('unwraps a bracketed IPv6 host and ignores a query or fragment', () => {
    expect(splitServerAddress('https://[fe80::1]:8080/dav?x=1#top')).toEqual({
      host: '[fe80::1]/dav',
      protocol: 'WEBDAV',
      webdavHttps: true,
      port: '8080',
    });
  });

  it('leaves a root-only path as no folder', () => {
    expect(splitServerAddress('https://nas/')).toEqual({
      host: 'nas',
      protocol: 'WEBDAV',
      webdavHttps: true,
    });
  });

  it('leaves an unknown scheme for native validation to reject', () => {
    expect(splitServerAddress('smb://nas/share')).toBeNull();
  });
});

describe('withFirstRemoteRoot', () => {
  it('fills the first folder only and leaves the others alone (Story 3 sc. 8)', () => {
    const roots = ['/old', '/scan/clean/b', '/c'];

    expect(withFirstRemoteRoot(roots, '/scan/clean/a')).toEqual([
      '/scan/clean/a',
      '/scan/clean/b',
      '/c',
    ]);
    expect(roots).toEqual(['/old', '/scan/clean/b', '/c']);
  });

  it('keeps every folder when the URL names none', () => {
    expect(withFirstRemoteRoot(['/a', '/b'], undefined)).toEqual(['/a', '/b']);
  });

  it('fills an empty first field and never returns an empty list', () => {
    expect(withFirstRemoteRoot([''], '/dav')).toEqual(['/dav']);
    expect(withFirstRemoteRoot([], '/dav')).toEqual(['/dav']);
    expect(withFirstRemoteRoot([], undefined)).toEqual(['']);
  });

  it('takes the folder a split URL names', () => {
    const parts = splitServerAddress('sftp://nas.local/scan/clean/a/');

    expect(
      withFirstRemoteRoot(['', '/scan/clean/b'], parts?.remoteRoot),
    ).toEqual(['/scan/clean/a', '/scan/clean/b']);
  });
});
