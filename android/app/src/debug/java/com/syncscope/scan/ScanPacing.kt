package com.syncscope.scan

import android.content.Context
import kotlinx.coroutines.delay

/**
 * Debug-only scan pacing (decision log 2026-10-01). A run over the seven Scan fixture files can
 * finish before Maestro's next hierarchy snapshot, so `01-clean-scan-*` could never prove that the
 * progress card is drawn. The debug repository seam stores a per-file pause from its `scanDelayMs`
 * query parameter, and [ScanEngine] then waits that long before matching each local file.
 *
 * The value lives in a debug-only preferences file, because Maestro's `launchApp` restarts the
 * process between the seam and the scan; `clearState` wipes it with the rest of the app data. The
 * release source set has a no-op [ScanPacing], so release builds have no pause and no such file.
 */
object ScanPacing {
  /** Upper bound, so a typo in a flow cannot stall a run for minutes per file. */
  const val MAX_DELAY_MILLIS = 5_000L

  private const val PREFS = "syncscope-debug-scan-pacing"
  private const val KEY = "perFileDelayMillis"

  /** Stores the pause; 0 (what every seam call without `scanDelayMs` stores) means none. */
  fun setPerFileDelay(context: Context, millis: Long) {
    prefs(context).edit().putLong(KEY, millis.coerceIn(0L, MAX_DELAY_MILLIS)).commit()
  }

  fun perFileDelay(context: Context): Long = prefs(context).getLong(KEY, 0L)

  /** The engine's per-file hook. Cancellable: a cancel during the pause ends the run as usual. */
  fun pause(context: Context): suspend () -> Unit {
    val app = context.applicationContext
    return {
      val millis = perFileDelay(app)
      if (millis > 0) delay(millis)
    }
  }

  private fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
