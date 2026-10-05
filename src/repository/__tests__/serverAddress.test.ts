import {splitServerAddress} from '../serverAddress';

describe('splitServerAddress', () => {
  it.each(['nas.local', '192.168.1.10', ' nas.local ', 'fe80::1', '2001:db8::7'])(
    'leaves the bare host %p alone',
    host => {
      expect(splitServerAddress(host)).toBeNull();
    },
  );

  it('splits a full WebDAV URL into protocol, HTTPS, host, port and folder', () => {
    expect(
      splitServerAddress('https://cloud.example.com:8443/remote.php/dav/files/me/'),
    ).toEqual({
      host: 'cloud.example.com',
      protocol: 'WEBDAV',
      webdavHttps: true,
      port: '8443',
      remoteRoot: '/remote.php/dav/files/me',
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
      host: 'fe80::1',
      protocol: 'WEBDAV',
      webdavHttps: true,
      port: '8080',
      remoteRoot: '/dav',
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
