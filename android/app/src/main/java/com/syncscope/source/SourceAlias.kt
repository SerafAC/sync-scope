package com.syncscope.source

/** What the alias of a new source is generated from. */
data class AliasCandidate(
  val volumeId: String,
  /** `StorageVolume.getDescription`, e.g. "Internal shared storage" or "SDCARD". */
  val volumeLabel: String,
  /** Path within the volume without leading or trailing `/`. Empty for a volume root. */
  val documentPath: String,
)

/**
 * Alias generation (research R6, FR-004). The alias is generated once when a source is added,
 * unique case-insensitively, and never edited or recomputed: there is deliberately no update path.
 */
object SourceAlias {

  /**
   * Returns the first form of [candidate] not already in [existingAliases] (compared
   * case-insensitively):
   * 1. the folder name, or the volume label for a volume root;
   * 2. `"<name> (<volume label>)"`;
   * 3. `"<name> (<volume label>, <parent>)"`, then `"<grandparent>/<parent>"` and further
   *    segments until unique.
   *
   * Distinct roots differ in volume or in some path segment, so when every readable form is
   * taken (two volumes with the same label and path), the volume ID disambiguates. A numeric
   * suffix is the last-resort backstop that guarantees the walk ends for any input.
   */
  fun generate(candidate: AliasCandidate, existingAliases: Collection<String>): String {
    val taken = existingAliases.mapTo(HashSet()) { it.lowercase() }
    val forms = forms(candidate)
    forms.firstOrNull { it.lowercase() !in taken }?.let { return it }
    val last = forms.last()
    return generateSequence(2) { it + 1 }.map { "$last #$it" }.first { it.lowercase() !in taken }
  }

  private fun forms(candidate: AliasCandidate): List<String> {
    val label = candidate.volumeLabel
    val segments = candidate.documentPath.split('/').filter { it.isNotEmpty() }
    if (segments.isEmpty()) {
      return listOf(label, "$label (${candidate.volumeId})")
    }
    val name = segments.last()
    val parents = segments.dropLast(1)
    val forms = mutableListOf(name, "$name ($label)")
    for (depth in 1..parents.size) {
      forms += "$name ($label, ${parents.takeLast(depth).joinToString("/")})"
    }
    val allParents = if (parents.isEmpty()) "" else ", ${parents.joinToString("/")}"
    forms += "$name ($label ${candidate.volumeId}$allParents)"
    return forms.distinct()
  }
}
