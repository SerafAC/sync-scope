package com.syncscope.source

/**
 * Identity of a picked SAF tree (research R3), parsed from its authority and tree document ID
 * (callers obtain the ID with `DocumentsContract.getTreeDocumentId`). Pure: no I/O, no Android types.
 *
 * The case the picker returns is kept as is; DocumentsUI always returns the on-disk spelling.
 */
data class SourceTree(
  val authority: String,
  /** `primary`, or the removable volume's UUID (`XXXX-XXXX`). */
  val volumeId: String,
  /** Path within the volume without leading or trailing `/`. Empty for a volume root. */
  val documentPath: String,
) {
  /** `<authority>/<volumeId>:<documentPath>`; unique per `source_root` row. */
  val canonicalRoot: String get() = "$authority/$volumeId:$documentPath"

  val isVolumeRoot: Boolean get() = documentPath.isEmpty()

  /** V1: only the external storage provider (internal storage and SD card) is supported. */
  val isSupported: Boolean get() = isSupportedAuthority(authority)

  companion object {
    const val EXTERNAL_STORAGE_AUTHORITY = "com.android.externalstorage.documents"

    fun isSupportedAuthority(authority: String): Boolean = authority == EXTERNAL_STORAGE_AUTHORITY

    /**
     * Splits a tree document ID such as `primary:DCIM/Camera` into volume and path.
     * @throws IllegalArgumentException when the ID has no `<volumeId>:` prefix.
     */
    fun parse(authority: String, treeDocumentId: String): SourceTree {
      val separator = treeDocumentId.indexOf(':')
      require(separator > 0) { "Tree document ID has no volume prefix" }
      return SourceTree(
        authority = authority,
        volumeId = treeDocumentId.substring(0, separator),
        documentPath = treeDocumentId.substring(separator + 1).trim('/'),
      )
    }

    /**
     * V2: two trees overlap when they share authority and volume and one path equals the other
     * or is its prefix at a `/` boundary. A volume root overlaps every path on its volume.
     */
    fun overlaps(a: SourceTree, b: SourceTree): Boolean {
      if (a.authority != b.authority || a.volumeId != b.volumeId) return false
      return isSameOrAncestor(a.documentPath, b.documentPath) ||
        isSameOrAncestor(b.documentPath, a.documentPath)
    }

    private fun isSameOrAncestor(ancestor: String, path: String): Boolean =
      ancestor.isEmpty() || path == ancestor || path.startsWith("$ancestor/")
  }
}
