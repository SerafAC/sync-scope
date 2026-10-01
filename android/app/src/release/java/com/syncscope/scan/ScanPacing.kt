package com.syncscope.scan

import android.content.Context

/**
 * Release twin of the debug-only scan pacing (decision log 2026-10-01): release builds have no
 * seam to set a pause, so the engine's per-file hook does nothing.
 */
object ScanPacing {
  private val NONE: suspend () -> Unit = {}

  @Suppress("UNUSED_PARAMETER")
  fun pause(context: Context): suspend () -> Unit = NONE
}
