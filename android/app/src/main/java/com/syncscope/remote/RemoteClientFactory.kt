package com.syncscope.remote

/** Builds a fresh, unconnected [RemoteClient] for a protocol; each connect attempt gets its own. */
fun interface RemoteClientFactory {
  fun create(protocol: RemoteProtocol): RemoteClient

  companion object {
    /** The production clients; SFTP answers host-key questions against [hostKeys]. */
    fun default(hostKeys: () -> HostKeyTrustStore): RemoteClientFactory = RemoteClientFactory { protocol ->
      when (protocol) {
        RemoteProtocol.FTP -> FtpRemoteClient()
        RemoteProtocol.SFTP -> SftpRemoteClient(hostKeys())
        RemoteProtocol.WEBDAV -> WebDavRemoteClient()
      }
    }
  }
}
