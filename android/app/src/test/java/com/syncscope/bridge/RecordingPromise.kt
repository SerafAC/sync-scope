package com.syncscope.bridge

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Captures what a module method resolved, and whether it (wrongly) rejected. */
internal class RecordingPromise : Promise {
  var resolved: Any? = null
  var rejectedCode: String? = null

  private val settled = CountDownLatch(1)

  override fun resolve(value: Any?) {
    resolved = value
    settled.countDown()
  }

  /** For methods whose work hops threads (e.g. Room suspend DAOs) before resolving. */
  fun await(): Any? {
    check(settled.await(10, TimeUnit.SECONDS)) { "promise never settled" }
    return resolved
  }

  private fun rejected(code: String?) {
    rejectedCode = code ?: "rejected"
    settled.countDown()
  }

  override fun reject(code: String?, message: String?) = rejected(code)

  override fun reject(code: String?, throwable: Throwable?) = rejected(code)

  override fun reject(code: String?, message: String?, throwable: Throwable?) = rejected(code)

  override fun reject(throwable: Throwable) = rejected(null)

  override fun reject(throwable: Throwable, userInfo: WritableMap) = rejected(null)

  override fun reject(code: String?, userInfo: WritableMap) = rejected(code)

  override fun reject(code: String?, throwable: Throwable?, userInfo: WritableMap) = rejected(code)

  override fun reject(code: String?, message: String?, userInfo: WritableMap) = rejected(code)

  override fun reject(code: String?, message: String?, throwable: Throwable?, userInfo: WritableMap?) =
    rejected(code)

  @Deprecated("Prefer reject(code, message)")
  override fun reject(message: String) = rejected(null)
}
