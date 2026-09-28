package com.syncscope.source

import android.provider.DocumentsContract

/** Tree URI string for [treeDocumentId] on [authority], in the form the picker returns. */
fun treeUri(treeDocumentId: String, authority: String = SourceTree.EXTERNAL_STORAGE_AUTHORITY): String =
  DocumentsContract.buildTreeDocumentUri(authority, treeDocumentId).toString()

/** In-memory [SafAccess] that records every call, for deterministic source tests (research R9). */
class FakeSafAccess : SafAccess {
  val grants = linkedMapOf<String, PersistedGrant>()
  val missingRoots = mutableSetOf<String>()
  val labels = mutableMapOf("primary" to "Internal shared storage")
  var grantsWrite = true

  var persistedGrantsCalls = 0
  val rootQueries = mutableListOf<String>()
  val taken = mutableListOf<String>()
  val released = mutableListOf<String>()

  /** Adds a persisted grant as if the source had been picked earlier. */
  fun hold(uri: String, canRead: Boolean = true, canWrite: Boolean = true) {
    grants[uri] = PersistedGrant(uri, canRead, canWrite)
  }

  override fun persistedGrants(): List<PersistedGrant> {
    persistedGrantsCalls++
    return grants.values.toList()
  }

  override fun takeGrant(uri: String): PersistedGrant {
    taken += uri
    return PersistedGrant(uri, canRead = true, canWrite = grantsWrite).also { grants[uri] = it }
  }

  override fun releaseGrant(uri: String) {
    released += uri
    grants.remove(uri)
  }

  override fun rootExists(uri: String): Boolean {
    rootQueries += uri
    return uri !in missingRoots
  }

  override fun volumeLabel(volumeId: String): String =
    labels[volumeId] ?: ContentResolverSafAccess.UNMOUNTED_VOLUME_LABEL
}
