package com.syncscope.remote

/**
 * The repository's remote folders (research R11). This is the only place their rules live
 * (Principle III): normalization, the overlap check, validation with the save table's field errors
 * (contracts/cloudsync-polish.md › saveRepository) and the stored form.
 *
 * Stored in `repository_config.remoteRoots` as one `\n`-separated string, in the user's order. An
 * existing single folder is a one-element list.
 */
object RemoteRoots {
  private const val SEPARATOR = "\n"

  /** The longest normalized folder path accepted on save. */
  const val MAX_LENGTH = 1024

  const val MESSAGE_EMPTY = "Add at least one remote folder."
  const val MESSAGE_LINE_BREAK = "A folder name cannot contain a line break."
  const val MESSAGE_RELATIVE = "A folder cannot contain . or .. segments."
  const val MESSAGE_UNSUPPORTED = "A folder name cannot contain control characters."
  const val MESSAGE_TOO_LONG = "A folder path can be at most $MAX_LENGTH characters."

  /** The overlap message, naming the earlier folder [other] (FR-009). */
  fun overlapMessage(other: String): String = "This folder is the same as, inside or around $other."

  private val LINE_BREAK = Regex("""[\n\r]""")
  private val CONTROL = Regex("""\p{Cntrl}""")
  private val REPEATED_SLASH = Regex("/{2,}")

  /** The later folder at [index] overlaps the earlier folder [other]. */
  data class Overlap(val index: Int, val other: String)

  sealed interface Validation {
    /** Every folder is acceptable; [roots] holds them normalized, in order, blank entries dropped. */
    data class Valid(val roots: List<String>) : Validation

    /** The first field error: [fieldIndex] is the folder's index in the list as given. */
    data class Invalid(val fieldIndex: Int, val message: String) : Validation
  }

  /** Trimmed, `/`-prefixed, repeated `/` collapsed, no trailing `/` (the root stays `/`). */
  fun normalize(folder: String): String {
    val collapsed = REPEATED_SLASH.replace("/" + folder.trim(), "/")
    return if (collapsed.length > 1) collapsed.trimEnd('/').ifEmpty { "/" } else collapsed
  }

  /** Whether [a] and [b] (both normalized) are equal or one is inside the other at a `/` boundary. */
  fun overlaps(a: String, b: String): Boolean = a == b || contains(a, b) || contains(b, a)

  private fun contains(outer: String, inner: String): Boolean =
    outer == "/" || inner.startsWith("$outer/")

  /**
   * The first folder of [roots] (normalized) that equals or nests with an earlier one, with that earlier
   * folder; null when no two overlap.
   */
  fun overlapOf(roots: List<String>): Overlap? {
    for (later in roots.indices) {
      for (earlier in 0 until later) {
        if (overlaps(roots[earlier], roots[later])) return Overlap(later, roots[earlier])
      }
    }
    return null
  }

  /**
   * Validates the folders the user gave, in order. Blank entries are ignored; an empty or all-blank list
   * is an error at index `0`. For each folder in turn: a line break, any other control character, a `.` or
   * `..` segment, an overlong path, or an overlap with an earlier folder is the first field error.
   */
  fun validate(roots: List<String>): Validation {
    val accepted = ArrayList<String>()
    for ((index, raw) in roots.withIndex()) {
      if (raw.isBlank()) continue
      if (LINE_BREAK.containsMatchIn(raw)) return Validation.Invalid(index, MESSAGE_LINE_BREAK)
      if (CONTROL.containsMatchIn(raw)) return Validation.Invalid(index, MESSAGE_UNSUPPORTED)
      val folder = normalize(raw)
      if (folder.split('/').any { it == "." || it == ".." }) return Validation.Invalid(index, MESSAGE_RELATIVE)
      if (folder.length > MAX_LENGTH) return Validation.Invalid(index, MESSAGE_TOO_LONG)
      accepted.firstOrNull { overlaps(it, folder) }?.let { return Validation.Invalid(index, overlapMessage(it)) }
      accepted += folder
    }
    if (accepted.isEmpty()) return Validation.Invalid(0, MESSAGE_EMPTY)
    return Validation.Valid(accepted)
  }

  /** Joins [roots] in order. A folder holding the separator would corrupt the list, so it is refused. */
  fun encode(roots: List<String>): String {
    require(roots.none { it.contains(SEPARATOR) }) { "a remote folder cannot contain a line break" }
    return roots.joinToString(SEPARATOR)
  }

  /** Splits [stored] on `\n`, in order, dropping blank entries. */
  fun decode(stored: String): List<String> = stored.split(SEPARATOR).filter { it.isNotBlank() }
}
