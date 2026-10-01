package com.syncscope.scan

/**
 * The live phase and counters of one run (research R9). The engine reports every change through
 * [update]; readers see [published], which moves at most once per [intervalMillis] of [clock], so a
 * poll every 500 ms never costs more than one snapshot per 250 ms of work. [latest] is the unthrottled
 * value, read once the run has ended.
 *
 * Written by one coroutine at a time (the run); read from any thread.
 */
class ScanProgress(
  private val clock: () -> Long,
  private val intervalMillis: Long = DEFAULT_INTERVAL_MILLIS,
  private val onPublish: (Counters) -> Unit = {},
) {
  /** Mirrors `ScanProgressDto`. */
  data class Counters(
    val remoteDirectoriesListed: Long = 0,
    val remoteFilesListed: Long = 0,
    val localFilesEnumerated: Long = 0,
    val localFilesMatched: Long = 0,
  )

  /** The current `ScanPhase` wire value; phase changes are visible at once, they are not throttled. */
  @Volatile var phase: String = ""

  @Volatile var published: Counters = Counters()
    private set

  @Volatile var latest: Counters = Counters()
    private set

  private var lastPublishedAt: Long? = null

  fun update(change: (Counters) -> Counters) {
    val next = change(latest)
    latest = next
    val now = clock()
    val last = lastPublishedAt
    if (last == null || now - last >= intervalMillis) {
      lastPublishedAt = now
      published = next
      onPublish(next)
    }
  }

  companion object {
    const val DEFAULT_INTERVAL_MILLIS = 250L
  }
}
