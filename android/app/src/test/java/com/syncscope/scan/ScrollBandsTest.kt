package com.syncscope.scan

import com.syncscope.bridge.CloudSyncContracts
import com.syncscope.bridge.ScrollUnit
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import kotlin.math.exp
import kotlin.math.ln
import kotlin.random.Random
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The band rules of the scroll index (research R5, R6): letters, adaptive date units and dynamic size bands.
 * Every input is sorted ascending and holds known values only; the store adds the unknown band and orders the
 * bands in the sort's direction.
 */
class ScrollBandsTest {

  // --- letters ---

  @Test
  fun oneLetterBandPerNonEmptyLetterWithHashFirst() {
    val bands = ScrollBands.letters(mapOf("b" to 2, "z" to 0, "#" to 1, "a" to 3, "m" to 4))

    assertEquals(listOf("#", "a", "b", "m"), bands.map { it.letter })
    assertEquals(listOf(1, 3, 2, 4), bands.map { it.count })
  }

  @Test
  fun noLettersGiveNoBands() {
    assertEquals(emptyList<ScrollBand>(), ScrollBands.letters(emptyMap()))
  }

  // --- dates ---

  @Test
  fun tenYearsOfFilesGiveYearBandsStartingAtTheLocalNewYear() {
    val millis = (2014..2023).flatMap { year -> listOf(1, 6, 11).map { at(year, it, 15) } }.sorted()

    val result = ScrollBands.dates(millis.toLongArray(), ZONE)

    assertEquals(ScrollUnit.YEAR, result.unit)
    assertEquals((2014..2023).map { midnight(it, 1, 1) }, result.bands.map { it.startMillis })
    assertTrue(result.bands.all { it.count == 3 })
  }

  @Test
  fun fewerThanFiveYearsFallBackToMonths() {
    // Four years, seven months: months are the coarsest unit with at least five bands.
    val millis = listOf(at(2020, 3, 1), at(2021, 3, 1), at(2021, 7, 9), at(2022, 1, 2), at(2022, 1, 20), at(2023, 5, 5), at(2023, 6, 5), at(2023, 8, 5))

    val result = ScrollBands.dates(millis.toLongArray(), ZONE)

    assertEquals(ScrollUnit.MONTH, result.unit)
    assertEquals(
      listOf(midnight(2020, 3, 1), midnight(2021, 3, 1), midnight(2021, 7, 1), midnight(2022, 1, 1), midnight(2023, 5, 1), midnight(2023, 6, 1), midnight(2023, 8, 1)),
      result.bands.map { it.startMillis },
    )
    assertEquals(listOf(1, 1, 1, 2, 1, 1, 1), result.bands.map { it.count })
  }

  @Test
  fun threeWeeksGiveDayBands() {
    // 2025-03-20 … 2025-04-09: two months, so days.
    val start = LocalDate.of(2025, 3, 20)
    val millis = (0 until 21).map { start.plusDays(it.toLong()).atTime(12, 0).atZone(ZONE).toInstant().toEpochMilli() }

    val result = ScrollBands.dates(millis.toLongArray(), ZONE)

    assertEquals(ScrollUnit.DAY, result.unit)
    assertEquals(21, result.bands.size)
    assertEquals((0 until 21).map { start.plusDays(it.toLong()).atStartOfDay(ZONE).toInstant().toEpochMilli() }, result.bands.map { it.startMillis })
  }

  @Test
  fun filesOfOneDayGiveOneDayBand() {
    val millis = listOf(at(2024, 2, 29, 0), at(2024, 2, 29, 9), at(2024, 2, 29, 23))

    val result = ScrollBands.dates(millis.toLongArray(), ZONE)

    assertEquals(ScrollUnit.DAY, result.unit)
    assertEquals(listOf(ScrollBand(count = 3, startMillis = midnight(2024, 2, 29))), result.bands)
  }

  @Test
  fun emptyYearsAreSkipped() {
    val millis = listOf(2010, 2012, 2015, 2018, 2020).map { at(it, 4, 4) }

    val result = ScrollBands.dates(millis.toLongArray(), ZONE)

    assertEquals(ScrollUnit.YEAR, result.unit)
    assertEquals(listOf(2010, 2012, 2015, 2018, 2020).map { midnight(it, 1, 1) }, result.bands.map { it.startMillis })
  }

  @Test
  fun periodsFollowTheLocalZoneNotUtc() {
    // 23:30 UTC on 10 March is 00:30 on 11 March in Berlin.
    val lateUtc = LocalDateTime.of(2025, 3, 10, 23, 30).atZone(ZoneId.of("UTC")).toInstant().toEpochMilli()

    val result = ScrollBands.dates(longArrayOf(lateUtc), ZONE)

    assertEquals(listOf(midnight(2025, 3, 11)), result.bands.map { it.startMillis })
  }

  // --- sizes ---

  @Test
  fun aWideRangeUsesOneTwoFiveBoundaries() {
    val sizes = geometric(1_000, 50_000.0, 2_000_000_000.0)

    val bands = ScrollBands.sizes(sizes)

    val lowers = bands.map { it.lowerBytes!! }
    assertTrue(lowers.toString(), lowers.containsAll(listOf(100_000L, 1_000_000L, 10_000_000L)))
    assertTrue(lowers.toString(), lowers.all(::isOneTwoFive))
    assertWellFormed(sizes, bands)
  }

  @Test
  fun aNarrowRangeUsesALinearNiceStep() {
    // SC-008: 200 files of 3–5 MB with many distinct sizes.
    val sizes = LongArray(200) { 3_000_000L + it * 10_000L }

    val bands = ScrollBands.sizes(sizes)

    val lowers = bands.map { it.lowerBytes!! }
    assertTrue(lowers.toString(), bands.size >= CloudSyncContracts.SCROLL_BANDS_MIN)
    assertTrue(lowers.toString(), lowers.all { it % 200_000L == 0L })
    assertEquals(3_000_000L, lowers.first())
    assertWellFormed(sizes, bands)
  }

  @Test
  fun aFewHugeOutliersGetOneBandOfTheirOwn() {
    val sizes = (LongArray(100) { 3_000_000L + it * 19_000L } + longArrayOf(2_000_000_000L, 2_100_000_000L)).sortedArray()

    val bands = ScrollBands.sizes(sizes)

    assertEquals(2, bands.last().count)
    assertTrue(bands.last().lowerBytes!! <= 2_000_000_000L)
    assertTrue(bands.last().lowerBytes!! > 4_881_000L)
    assertTrue(bands.size >= CloudSyncContracts.SCROLL_BANDS_MIN)
    assertWellFormed(sizes, bands)
  }

  @Test
  fun valuesBelowTheFifthPercentileJoinTheFirstBand() {
    val sizes = (longArrayOf(10L, 12L, 15L) + LongArray(97) { 3_000_000L + it * 20_000L }).sortedArray()

    val bands = ScrollBands.sizes(sizes)

    assertTrue(bands.first().lowerBytes!! >= 2_000_000L)
    assertTrue(bands.first().count >= 4)
    assertWellFormed(sizes, bands)
  }

  @Test
  fun aBandOverHalfOfTheFilesIsSplit() {
    // 60 files within 1–2 kB fall in one 1-2-5 band; the rest spread to 1 GB.
    val sizes = (LongArray(60) { 1_000L + it * 15L } + geometric(40, 5_000.0, 1_000_000_000.0)).sortedArray()

    val bands = ScrollBands.sizes(sizes)

    assertTrue(bands.toString(), bands.all { it.count * 2 <= sizes.size })
    assertWellFormed(sizes, bands)
  }

  @Test
  fun moreThanTheMaximumBandsAreMergedPairwise() {
    // Twelve decades of 1-2-5 boundaries is ~36 bands before merging.
    val sizes = geometric(2_000, 1.0, 1_000_000_000_000.0)

    val bands = ScrollBands.sizes(sizes)

    assertTrue(bands.toString(), bands.size <= CloudSyncContracts.SCROLL_BANDS_MAX)
    assertTrue(bands.map { it.lowerBytes!! }.all(::isOneTwoFive))
    assertWellFormed(sizes, bands)
  }

  @Test
  fun overHalfSharingOneSizeMayHoldOverHalf() {
    val sizes = (LongArray(60) { 5_000_000L } + LongArray(40) { 100_000L + it * 50_000L }).sortedArray()

    val bands = ScrollBands.sizes(sizes)

    assertTrue(bands.any { it.count >= 60 })
    assertWellFormed(sizes, bands)
  }

  @Test
  fun equalSizesGiveOneBand() {
    val sizes = LongArray(50) { 4_096L }

    assertEquals(listOf(ScrollBand(count = 50, lowerBytes = 4_096L)), ScrollBands.sizes(sizes))
  }

  @Test
  fun noSizesGiveNoBands() {
    assertEquals(emptyList<ScrollBand>(), ScrollBands.sizes(LongArray(0)))
  }

  @Test
  fun anyDistributionWithEightDistinctSizesHasFiveToFifteenBalancedBands() {
    val random = Random(7)
    repeat(300) { round ->
      val n = 8 + random.nextInt(400)
      val sizes =
        when (round % 5) {
          // Uniform, log-uniform, two clusters, a heavy repeated size, and tiny files with zeros.
          0 -> LongArray(n) { random.nextLong(1_000_000L, 9_000_000L) }
          1 -> LongArray(n) { exp(random.nextDouble(ln(10.0), ln(5e10))).toLong() }
          2 -> LongArray(n) { if (it % 2 == 0) 1_000L + random.nextInt(4) else 1_000_000L + random.nextInt(4) }
          3 -> LongArray(n) { if (random.nextInt(10) < 6) 777_777L else random.nextLong(1L, 50_000_000L) }
          else -> LongArray(n) { random.nextLong(0L, 40L) }
        }.sortedArray()
      val bands = ScrollBands.sizes(sizes)
      assertWellFormed(sizes, bands)
      if (sizes.distinct().size >= 8) {
        assertTrue("round $round: ${bands.size} bands", bands.size in CloudSyncContracts.SCROLL_BANDS_MIN..CloudSyncContracts.SCROLL_BANDS_MAX)
        val shared = sizes.groupBy { it }.values.maxOf { it.size }
        if (shared * 2 <= sizes.size) {
          assertTrue("round $round: $bands", bands.all { it.count * 2 <= sizes.size })
        }
      }
    }
  }

  /** Counts add up, no band is empty, bounds strictly increase, and each value sits in its band's range. */
  private fun assertWellFormed(sizes: LongArray, bands: List<ScrollBand>) {
    assertEquals(sizes.size, bands.sumOf { it.count })
    assertTrue(bands.all { it.count > 0 })
    val lowers = bands.map { it.lowerBytes!! }
    assertTrue(lowers.toString(), lowers.zipWithNext().all { (a, b) -> a < b })
    var index = 0
    for ((i, band) in bands.withIndex()) {
      val upper = bands.getOrNull(i + 1)?.lowerBytes ?: Long.MAX_VALUE
      repeat(band.count) {
        val value = sizes[index++]
        // Only the first band holds values below its own bound.
        assertTrue("$value in band $band", value < upper && (i == 0 || value >= band.lowerBytes!!))
      }
    }
  }

  private fun isOneTwoFive(value: Long): Boolean {
    var v = value
    while (v >= 10 && v % 10 == 0L) v /= 10
    return v == 1L || v == 2L || v == 5L
  }

  private fun geometric(count: Int, from: Double, to: Double): LongArray =
    LongArray(count) { exp(ln(from) + (ln(to) - ln(from)) * it / (count - 1)).toLong() }

  private fun at(year: Int, month: Int, day: Int, hour: Int = 12): Long =
    LocalDateTime.of(year, month, day, hour, 0).atZone(ZONE).toInstant().toEpochMilli()

  private fun midnight(year: Int, month: Int, day: Int): Long = LocalDate.of(year, month, day).atStartOfDay(ZONE).toInstant().toEpochMilli()

  private companion object {
    val ZONE: ZoneId = ZoneId.of("Europe/Berlin")
  }
}
