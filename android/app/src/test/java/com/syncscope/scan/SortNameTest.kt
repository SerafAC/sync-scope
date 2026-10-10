package com.syncscope.scan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The stored name sort key (research R2): case- and accent-insensitive, `#` names before letters. */
class SortNameTest {

  @Test
  fun foldsAccentsAndCaseAndPrefixesLetters() {
    assertEquals("1eclair", SortName.of("Éclair"))
    assertEquals(SortName.of("Apple"), SortName.of("apple"))
    assertEquals("1apple", SortName.of("apple"))
    assertEquals("1a", SortName.of("Ä"))
  }

  @Test
  fun prefixesDigitsSymbolsAndOtherScriptsWithZero() {
    assertEquals("02024.jpg", SortName.of("2024.jpg"))
    assertEquals("0_x", SortName.of("_x"))
    assertTrue(SortName.of("日本").startsWith("0"))
    assertEquals("0", SortName.of(""))
  }

  @Test
  fun hashNamesSortBeforeLettersAndLettersReadAlphabetically() {
    val names = listOf("Éclair", "banana", "2024.jpg", "apple", "_x", "Zebra")
    assertEquals(
      listOf("2024.jpg", "_x", "apple", "banana", "Éclair", "Zebra"),
      names.sortedBy { SortName.of(it) },
    )
  }

  @Test
  fun letterOfReadsHashForPrefixZeroAndTheFirstLetterOtherwise() {
    assertEquals("#", SortName.letterOf(SortName.of("2024.jpg")))
    assertEquals("#", SortName.letterOf(SortName.of("日本")))
    assertEquals("#", SortName.letterOf(SortName.of("")))
    assertEquals("e", SortName.letterOf(SortName.of("Éclair")))
    assertEquals("a", SortName.letterOf(SortName.of("Ä")))
    assertEquals("z", SortName.letterOf("1zebra"))
  }
}
