package com.syncscope.bridge

import android.content.Context
import android.content.SharedPreferences
import androidx.test.core.app.ApplicationProvider
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.ReadableMap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Browse preferences in `SharedPreferences` (research R10, data-model "Browse preferences"). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class BrowsePreferencesTest {

  private lateinit var prefs: SharedPreferences
  private lateinit var preferences: BrowsePreferences

  @Before
  fun setUp() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    prefs = context.getSharedPreferences(BrowsePreferences.FILE_NAME, Context.MODE_PRIVATE)
    prefs.edit().clear().commit()
    preferences = BrowsePreferences({ prefs }, CloudSyncEnvelope({ JavaOnlyMap() }, { JavaOnlyArray() }))
  }

  @Test
  fun theFirstReadReturnsTheDefaults() {
    val result = preferences.get()

    assertEquals("ok", result.getString("status"))
    assertEquals(6, result.getInt("contractVersion"))
    assertEquals(mapOf("view" to "GALLERY", "gallerySort" to "TIME_DESC", "listSort" to "NAME_ASC"), valuesOf(result))
    // Reading writes nothing.
    assertTrue(prefs.all.isEmpty())
  }

  @Test
  fun storedValuesRoundTrip() {
    val saved = preferences.set(JavaOnlyMap.of("view", "LIST", "gallerySort", "SIZE_DESC", "listSort", "SIZE_ASC"))

    assertEquals("ok", saved.getString("status"))
    assertEquals(mapOf("view" to "LIST", "gallerySort" to "SIZE_DESC", "listSort" to "SIZE_ASC"), valuesOf(preferences.get()))
    assertEquals("LIST", prefs.getString("view", null))
    assertEquals("SIZE_DESC", prefs.getString("gallerySort", null))
    assertEquals("SIZE_ASC", prefs.getString("listSort", null))
  }

  @Test
  fun anUnknownStoredValueReadsAsItsDefault() {
    prefs.edit().putString("view", "TREE").putString("gallerySort", "COLOUR_ASC").putString("listSort", "TIME_ASC").commit()

    assertEquals(mapOf("view" to "GALLERY", "gallerySort" to "TIME_DESC", "listSort" to "TIME_ASC"), valuesOf(preferences.get()))
  }

  @Test
  fun aStoredValueOfAnotherTypeReadsAsItsDefault() {
    prefs.edit().putInt("view", 3).commit()

    assertEquals("GALLERY", valuesOf(preferences.get())["view"])
  }

  @Test
  fun setStoresOnlyTheGivenFields() {
    preferences.set(JavaOnlyMap.of("listSort", "NAME_DESC"))
    preferences.set(JavaOnlyMap.of("view", "LIST"))

    assertEquals(setOf("listSort", "view"), prefs.all.keys)
    assertEquals(mapOf("view" to "LIST", "gallerySort" to "TIME_DESC", "listSort" to "NAME_DESC"), valuesOf(preferences.get()))
    // An empty or null field changes nothing.
    assertEquals("ok", preferences.set(JavaOnlyMap.of("gallerySort", null)).getString("status"))
    assertEquals("ok", preferences.set(JavaOnlyMap()).getString("status"))
    assertEquals(setOf("listSort", "view"), prefs.all.keys)
  }

  @Test
  fun anUnknownValueIsRejectedAndNothingIsStored() {
    val cases =
      listOf(
        JavaOnlyMap.of("view", "TREE") to "view",
        JavaOnlyMap.of("view", "LIST", "gallerySort", "COLOUR_ASC") to "gallerySort",
        JavaOnlyMap.of("listSort", "name_asc", "view", "LIST") to "listSort",
        JavaOnlyMap.of("listSort", 3.0) to "listSort",
      )
    for ((input, field) in cases) {
      val result = preferences.set(input)

      assertEquals("$input", "error", result.getString("status"))
      val error = result.getMap("error")!!
      assertEquals("$input", "INVALID_QUERY", error.getString("code"))
      assertEquals("$input", field, error.getString("field"))
      assertFalse("$input stored nothing", prefs.all.isNotEmpty())
    }
  }

  private fun valuesOf(result: ReadableMap): Map<String, String?> {
    val payload = result.getMap("preferences")!!
    return listOf("view", "gallerySort", "listSort").associateWith { payload.getString(it) }
  }
}
