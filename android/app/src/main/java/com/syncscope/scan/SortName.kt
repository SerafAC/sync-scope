package com.syncscope.scan

import java.text.Normalizer
import java.util.Locale

/**
 * The stored name sort key, `local_node.sortName` (research R2). This is the only name folding in the code
 * (Principle III): name sorts, letter bands and the scroll anchor all read it.
 *
 * The name is decomposed (Unicode NFKD), its combining marks are removed and it is lowercased with
 * [Locale.ROOT], so `É` → `e` and `Ä` → `a`. The result is prefixed `1` when it now starts with `a`–`z`, else
 * `0`: digits, symbols and other scripts form the `#` band, which sorts first, and every letter band is one
 * contiguous range of the sort.
 */
object SortName {
  private const val HASH_PREFIX = '0'
  private const val LETTER_PREFIX = '1'
  private const val HASH_LETTER = "#"
  private val combiningMarks = Regex("\\p{Mn}+")

  /** The sort key of [name]. */
  fun of(name: String): String {
    val folded = Normalizer.normalize(name, Normalizer.Form.NFKD).replace(combiningMarks, "").lowercase(Locale.ROOT)
    val prefix = if (folded.firstOrNull() in 'a'..'z') LETTER_PREFIX else HASH_PREFIX
    return prefix + folded
  }

  /** The letter band of a [sortName] made by [of]: `#` for prefix `0`, else its first letter. */
  fun letterOf(sortName: String): String =
    if (sortName.firstOrNull() == LETTER_PREFIX && sortName.length > 1) sortName.substring(1, 2) else HASH_LETTER
}
