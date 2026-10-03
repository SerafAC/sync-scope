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

  /** Documents that exist, by URI; [stat] returns `null` for any other URI. */
  val documents = linkedMapOf<String, DocumentStat>()

  /** Scripted [delete] results by URI; an unscripted delete of an existing document succeeds. */
  val deleteResults = mutableMapOf<String, DeleteResult>()

  /** URIs whose [stat] throws [SecurityException], as a revoked grant does. */
  val statDenied = mutableSetOf<String>()
  val statted = mutableListOf<String>()
  val deleted = mutableListOf<String>()

  /** Runs on every [delete] before the result is returned, e.g. to make a document vanish. */
  var onDelete: (String) -> Unit = {}

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

  override fun stat(documentUri: String): DocumentStat? {
    statted += documentUri
    if (documentUri in statDenied) throw SecurityException("Permission Denial")
    return documents[documentUri]
  }

  /**
   * Returns the scripted result, or [DeleteResult.DELETED] / [DeleteResult.NOT_FOUND] by existence. A
   * [DeleteResult.DELETED] removes the document; other results leave [documents] as they are.
   */
  override fun delete(documentUri: String): DeleteResult {
    deleted += documentUri
    onDelete(documentUri)
    val result =
      deleteResults[documentUri] ?: if (documentUri in documents) DeleteResult.DELETED else DeleteResult.NOT_FOUND
    if (result == DeleteResult.DELETED) documents.remove(documentUri)
    return result
  }
}
