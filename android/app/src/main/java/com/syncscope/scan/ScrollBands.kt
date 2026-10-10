package com.syncscope.scan

import com.syncscope.bridge.CloudSyncContracts.SCROLL_BANDS_MAX
import com.syncscope.bridge.CloudSyncContracts.SCROLL_BANDS_MIN
import com.syncscope.bridge.ScrollUnit
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * One band of the scroll index before the store places it: how many files it holds and its lower bound, which
 * is exactly one of [letter] (`#` or `a`…`z`), [startMillis] (the local start of a year, month or day) or
 * [lowerBytes]. The store adds the start index, the start token and the unknown band.
 */
data class ScrollBand(
  val count: Int,
  val letter: String? = null,
  val startMillis: Long? = null,
  val lowerBytes: Long? = null,
)

/** Date bands and the unit they were cut in (research R6). */
data class DateBands(val unit: ScrollUnit, val bands: List<ScrollBand>)

/**
 * The band rules of the scroll index (research R4–R6): the one place they live (Principle III). Pure functions
 * over known values sorted ascending; every result is in ascending order with no empty band, so the store only
 * reverses it for a descending sort and appends the unknown band.
 */
object ScrollBands {

  /** One band per non-empty letter, `#` first, then `a`…`z` (research R2: the order name sorts read in). */
  fun letters(counts: Map<String, Int>): List<ScrollBand> =
    counts.filterValues { it > 0 }.toSortedMap(compareBy<String> { it != HASH }.thenBy { it }).map { (letter, count) ->
      ScrollBand(count = count, letter = letter)
    }

  /**
   * Date bands in [zone] (research R6): years when they give at least [SCROLL_BANDS_MIN] non-empty bands, else
   * months when they do, else days. Each band starts at the local start of its period; empty periods are skipped.
   */
  fun dates(ascendingMillis: LongArray, zone: ZoneId): DateBands {
    for (unit in listOf(ScrollUnit.YEAR, ScrollUnit.MONTH)) {
      val bands = periods(ascendingMillis, zone, unit)
      if (bands.size >= SCROLL_BANDS_MIN) return DateBands(unit, bands)
    }
    return DateBands(ScrollUnit.DAY, periods(ascendingMillis, zone, ScrollUnit.DAY))
  }

  /**
   * Size bands (research R5, FR-007a). From the 5th and 95th percentiles `p5`, `p95`: a wide range
   * (`p95 / p5 ≥ 10`) uses the 1-2-5 series from `p5` to the largest size; a narrow one a linear step
   * `nice((p95 − p5) / 10)` with a top band above `p95`. Values below the first bound join the first band, so its
   * `lowerBytes` is the round bound, not the smallest size. Then:
   *
   * - a band over half of the files is split with the narrow rule on its own values (repeated while it still is
   *   and holds more than one size, so only a size shared by over half of the files keeps a band over half);
   * - with at least 8 distinct sizes, the fullest band holding more than one size is split until there are at
   *   least [SCROLL_BANDS_MIN] bands;
   * - over [SCROLL_BANDS_MAX] bands, the adjacent pair with the fewest files is merged, one pair at a time,
   *   which never makes a band over half of the files.
   */
  fun sizes(ascendingBytes: LongArray): List<ScrollBand> {
    if (ascendingBytes.isEmpty()) return emptyList()
    val values = ascendingBytes
    if (values.first() == values.last()) return listOf(ScrollBand(count = values.size, lowerBytes = values.first()))

    val p5 = percentile(values, 5)
    val p95 = percentile(values, 95)
    val wide = if (p5 > 0) p95 >= p5 * WIDE_RATIO else p95 > 0
    val bounds = if (wide) oneTwoFiveBoundaries(maxOf(p5, 1L), values.last()) else narrowBoundaries(p5, p95)
    var bands = assign(values, 0, values.size, bounds)

    val distinct = distinctCount(values, 0, values.size)
    if (distinct >= SPLIT_MIN_DISTINCT) {
      while (true) {
        val heavy = bands.indexOfFirst { it.count * 2 > values.size && it.distinct > 1 }
        if (heavy < 0) break
        bands = split(values, bands, heavy) ?: break
      }
      while (bands.size < SCROLL_BANDS_MIN) {
        val fullest = bands.indices.filter { bands[it].distinct > 1 }.maxByOrNull { bands[it].count } ?: break
        bands = split(values, bands, fullest) ?: break
      }
    }
    while (bands.size > SCROLL_BANDS_MAX) {
      val pair = (0 until bands.size - 1).minBy { bands[it].count + bands[it + 1].count }
      val a = bands[pair]
      val b = bands[pair + 1]
      val merged = Placed(a.lower, a.from, b.until, distinctCount(values, a.from, b.until))
      bands = bands.subList(0, pair) + merged + bands.subList(pair + 2, bands.size)
    }
    return bands.map { ScrollBand(count = it.count, lowerBytes = it.lower) }
  }

  // --- dates ---

  private fun periods(ascendingMillis: LongArray, zone: ZoneId, unit: ScrollUnit): List<ScrollBand> {
    val bands = ArrayList<ScrollBand>()
    var start = 0L
    var end = Long.MIN_VALUE
    var count = 0
    for (millis in ascendingMillis) {
      if (count == 0 || millis >= end) {
        if (count > 0) bands += ScrollBand(count = count, startMillis = start)
        val date = Instant.ofEpochMilli(millis).atZone(zone).toLocalDate()
        val first: LocalDate =
          when (unit) {
            ScrollUnit.YEAR -> date.withDayOfYear(1)
            ScrollUnit.MONTH -> date.withDayOfMonth(1)
            else -> date
          }
        val next: LocalDate =
          when (unit) {
            ScrollUnit.YEAR -> first.plusYears(1)
            ScrollUnit.MONTH -> first.plusMonths(1)
            else -> first.plusDays(1)
          }
        start = first.atStartOfDay(zone).toInstant().toEpochMilli()
        end = next.atStartOfDay(zone).toInstant().toEpochMilli()
        count = 0
      }
      count++
    }
    if (count > 0) bands += ScrollBand(count = count, startMillis = start)
    return bands
  }

  // --- sizes ---

  /** A size band over `values[from until until]` with its lower bound and number of distinct sizes. */
  private class Placed(val lower: Long, val from: Int, val until: Int, val distinct: Int) {
    val count: Int
      get() = until - from
  }

  /** Nearest-rank percentile of a sorted array. */
  private fun percentile(values: LongArray, percent: Int): Long = values[((values.size - 1).toLong() * percent / 100).toInt()]

  /** The 1-2-5 series (… 100, 200, 500, 1 000 …) from the largest member at or below [low] up to [high]. */
  private fun oneTwoFiveBoundaries(low: Long, high: Long): List<Long> {
    var decade = 1L
    while (decade <= low / 10) decade *= 10
    var bound = listOf(5L, 2L, 1L).map { it * decade }.first { it <= low }
    val bounds = ArrayList<Long>()
    while (bound <= high) {
      bounds += bound
      val leading = bound / decadeOf(bound)
      val next = if (leading == 2L) bound / 2 * 5 else bound * 2
      if (bound > Long.MAX_VALUE / 5) break
      bound = next
    }
    return bounds
  }

  private fun decadeOf(value: Long): Long {
    var decade = 1L
    while (decade <= value / 10) decade *= 10
    return decade
  }

  /**
   * A linear step `nice((high − low) / 10)` from `floor(low / step) × step` through [high], plus the next bound
   * above it, which opens the top band.
   */
  private fun narrowBoundaries(low: Long, high: Long): List<Long> {
    val step = nice((high - low) / NARROW_STEPS.toDouble())
    val bounds = ArrayList<Long>()
    var bound = low / step * step
    while (bound <= high) {
      bounds += bound
      bound += step
    }
    bounds += bound
    return bounds
  }

  /** [value] rounded to 1, 2 or 5 × 10ⁿ, at least 1. */
  private fun nice(value: Double): Long {
    if (value < 1.0) return 1L
    var decade = 1L
    while (decade <= (value / 10).toLong()) decade *= 10
    val fraction = value / decade
    return when {
      fraction < 1.5 -> decade
      fraction < 3.5 -> 2 * decade
      fraction < 7.5 -> 5 * decade
      else -> 10 * decade
    }
  }

  /**
   * The non-empty bands of `values[from until until]` cut at [bounds] (ascending): values below the first bound
   * join the first band, which keeps the first bound as its label.
   */
  private fun assign(values: LongArray, from: Int, until: Int, bounds: List<Long>): List<Placed> {
    val bands = ArrayList<Placed>()
    var index = from
    for ((i, lower) in bounds.withIndex()) {
      val upper = bounds.getOrNull(i + 1) ?: Long.MAX_VALUE
      val start = index
      while (index < until && values[index] < upper) index++
      if (index > start) bands += Placed(lower, start, index, distinctCount(values, start, index))
    }
    if (index < until) {
      // Unreachable while the last bound is open-ended; kept so no value can ever be lost.
      bands += Placed(bounds.last(), index, until, distinctCount(values, index, until))
    }
    return bands
  }

  /**
   * Splits `bands[at]` with the narrow rule on its own values, from `p5`/`p95` and, when that leaves one band,
   * from its smallest and largest size. Null when it cannot be split (it holds a single size).
   */
  private fun split(values: LongArray, bands: List<Placed>, at: Int): List<Placed>? {
    val band = bands[at]
    if (band.distinct < 2) return null
    val slice = values.copyOfRange(band.from, band.until)
    val attempts = listOf(percentile(slice, 5) to percentile(slice, 95), slice.first() to slice.last())
    for ((low, high) in attempts) {
      val inner = narrowBoundaries(low, high).filter { it > band.lower }
      val parts = assign(values, band.from, band.until, listOf(band.lower) + inner)
      if (parts.size > 1) return bands.subList(0, at) + parts + bands.subList(at + 1, bands.size)
    }
    return null
  }

  private fun distinctCount(values: LongArray, from: Int, until: Int): Int {
    var distinct = 0
    for (i in from until until) if (i == from || values[i] != values[i - 1]) distinct++
    return distinct
  }

  private const val HASH = "#"
  private const val WIDE_RATIO = 10L
  private const val NARROW_STEPS = 10
  private const val SPLIT_MIN_DISTINCT = 8
}
