package com.syncscope

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FoundationInstrumentedTest {
  @Test
  fun applicationContextUsesSyncScopePackage() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext

    assertEquals("com.syncscope", context.packageName)
  }
}
