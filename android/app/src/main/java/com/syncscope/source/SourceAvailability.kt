package com.syncscope.source

import com.syncscope.persistence.SourceRootEntity

/**
 * Whether a source can be read right now (research R5). Computed on every read, never stored.
 * This is the single implementation shared by `SourceOperations` and `LocalSourceEnumerator`.
 */
enum class SourceAvailability {
  AVAILABLE,
  GRANT_REVOKED,
  STORAGE_MISSING;

  companion object {
    /**
     * R5 order: [GRANT_REVOKED] when no grant in [grants] with read permission matches the
     * source's `treeUri`; then [STORAGE_MISSING] when the tree's root cannot be queried;
     * otherwise [AVAILABLE]. The root is queried only when the grant is present, so evaluating
     * a list costs one grant lookup (by the caller) and at most one root query per source.
     */
    fun of(source: SourceRootEntity, grants: Collection<PersistedGrant>, saf: SafAccess): SourceAvailability =
      when {
        grants.none { it.canRead && it.uri == source.treeUri } -> GRANT_REVOKED
        !saf.rootExists(source.treeUri) -> STORAGE_MISSING
        else -> AVAILABLE
      }

    /** [of] for a single source, looking the grants up itself. */
    fun of(source: SourceRootEntity, saf: SafAccess): SourceAvailability = of(source, saf.persistedGrants(), saf)
  }
}
