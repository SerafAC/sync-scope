package com.syncscope.bridge

import android.content.SharedPreferences
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.WritableMap
import com.syncscope.persistence.FileSort
import com.syncscope.persistence.FileView

/**
 * The Files tab's view mode and each view's sort, remembered across restarts in `SharedPreferences` file
 * [FILE_NAME] (research R10, data-model "Browse preferences"); `getBrowsePreferences` and
 * `setBrowsePreferences` (contract version 6). The filter is not stored (005 R10).
 *
 * A missing or unknown stored value reads as its default, so a value written by a newer build never breaks
 * an older one. A write validates every given field before storing any of them.
 */
class BrowsePreferences(
  private val prefs: () -> SharedPreferences,
  private val envelope: CloudSyncEnvelope,
) {
  /** `{status: "ok", preferences: {view, gallerySort, listSort}}`; never fails. */
  fun get(): WritableMap {
    val store = prefs()
    val payload =
      envelope.map().apply {
        for (field in Field.entries) putString(field.key, field.read(store))
      }
    return envelope.ok(PAYLOAD_KEY, payload)
  }

  /**
   * Stores the fields present in [preferences] and resolves `ok`; an absent or null field is left as it is.
   * An unknown value (or one that is not a string) is `INVALID_QUERY` naming the field, and nothing is stored.
   */
  fun set(preferences: ReadableMap): WritableMap {
    val updates = LinkedHashMap<String, String>()
    for (field in Field.entries) {
      if (!preferences.hasKey(field.key) || preferences.isNull(field.key)) continue
      val value = if (preferences.getType(field.key) == ReadableType.String) preferences.getString(field.key) else null
      if (value == null || value !in field.allowed) return invalid(field.key)
      updates[field.key] = value
    }
    if (updates.isNotEmpty()) {
      prefs().edit().apply { for ((key, value) in updates) putString(key, value) }.apply()
    }
    return envelope.ok()
  }

  private fun invalid(field: String): WritableMap =
    envelope.error(
      CloudSyncErrorCode.INVALID_QUERY,
      "The browse preference $field is invalid.",
      "Pick the option again.",
      field = field,
    )

  /** The stored keys, their allowed values and first-run defaults. */
  private enum class Field(val key: String, val allowed: Set<String>, val default: String) {
    VIEW("view", FileView.entries.mapTo(HashSet()) { it.name }, FileView.GALLERY.name),
    GALLERY_SORT("gallerySort", SORTS, FileSort.TIME_DESC.name),
    LIST_SORT("listSort", SORTS, FileSort.NAME_ASC.name);

    fun read(store: SharedPreferences): String {
      // A value of another type (never written by this class) reads as the default too.
      val stored = runCatching { store.getString(key, null) }.getOrNull()
      return stored?.takeIf { it in allowed } ?: default
    }
  }

  companion object {
    const val FILE_NAME = "browse_preferences"
    const val PAYLOAD_KEY = "preferences"
    private val SORTS: Set<String> = FileSort.entries.mapTo(HashSet()) { it.name }
  }
}
