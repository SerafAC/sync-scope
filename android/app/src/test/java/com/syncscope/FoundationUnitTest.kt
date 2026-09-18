package com.syncscope

import org.junit.Assert.assertEquals
import org.junit.Test

class FoundationUnitTest {
  @Test
  fun applicationIdRemainsStable() {
    assertEquals("com.syncscope", BuildConfig.APPLICATION_ID)
  }
}
