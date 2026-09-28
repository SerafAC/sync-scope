package com.syncscope.source

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.WritableMap
import com.syncscope.bridge.CloudSyncEnvelope
import com.syncscope.bridge.CloudSyncErrorCode
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CompletableDeferred

/**
 * The system folder picker behind `launchSourcePicker` (research R1).
 *
 * [launch] starts `ACTION_OPEN_DOCUMENT_TREE` on the current activity and suspends until the
 * result arrives through [onActivityResult] (registered as an `ActivityEventListener` on the
 * React context). One pick can be pending at a time: a second launch, or a launch with no
 * foreground activity, resolves `PICKER_BUSY`. The slot is cleared after every outcome. If the
 * process dies while the picker is open the result is lost and nothing is persisted, the same
 * outcome as a cancel.
 */
class SourcePicker(
  private val operations: SourceOperations,
  private val envelope: CloudSyncEnvelope,
  private val currentActivity: () -> Activity?,
) : BaseActivityEventListener() {

  /** The pending pick: completed with the picked tree URI, or null when the picker was closed. */
  private val slot = AtomicReference<CompletableDeferred<Uri?>?>(null)

  /** Opens the picker, at [regrantSourceId]'s folder when re-granting, and handles the pick. */
  suspend fun launch(regrantSourceId: String?): WritableMap {
    // SOURCE_NOT_FOUND is decided before the picker opens.
    val initialUri =
      regrantSourceId?.let {
        operations.regrantTarget(it) ?: return envelope.sourceError(CloudSyncErrorCode.SOURCE_NOT_FOUND)
      }
    val activity = currentActivity() ?: return envelope.sourceError(CloudSyncErrorCode.PICKER_BUSY)
    val pending = CompletableDeferred<Uri?>()
    if (!slot.compareAndSet(null, pending)) return envelope.sourceError(CloudSyncErrorCode.PICKER_BUSY)
    try {
      @Suppress("DEPRECATION")
      activity.startActivityForResult(intent(initialUri), REQUEST_CODE)
      val picked = pending.await() ?: return operations.cancelled()
      return operations.onPicked(picked.toString(), regrantSourceId)
    } finally {
      slot.compareAndSet(pending, null)
    }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != REQUEST_CODE) return
    slot.get()?.complete(if (resultCode == Activity.RESULT_OK) data?.data else null)
  }

  private fun intent(initialUri: String?): Intent =
    Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
      addFlags(
        Intent.FLAG_GRANT_READ_URI_PERMISSION or
          Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
          Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
      )
      initialUri?.let { putExtra(DocumentsContract.EXTRA_INITIAL_URI, Uri.parse(it)) }
    }

  companion object {
    /** Request code for the tree picker; results with any other code belong to someone else. */
    const val REQUEST_CODE = 0x5C01
  }
}
