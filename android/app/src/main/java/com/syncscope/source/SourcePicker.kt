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

  /**
   * Opens the picker and handles the pick. A re-grant starts at [regrantSourceId]'s own folder; a new
   * folder starts in DCIM (research R7), which the system ignores when DCIM does not exist.
   */
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
      putExtra(DocumentsContract.EXTRA_INITIAL_URI, initialUri?.let { startAt(Uri.parse(it)) } ?: dcimUri())
    }

  companion object {
    /** Request code for the tree picker; results with any other code belong to someone else. */
    const val REQUEST_CODE = 0x5C01

    /**
     * The re-granted source's own folder as a document URI. DocumentsUI only honours a document
     * URI as `EXTRA_INITIAL_URI`: a bare tree URI is ignored and the picker opens at the storage
     * root. Anything that is not a tree URI is passed through unchanged.
     */
    private fun startAt(source: Uri): Uri =
      if (DocumentsContract.isTreeUri(source)) {
        DocumentsContract.buildDocumentUriUsingTree(source, DocumentsContract.getTreeDocumentId(source))
      } else {
        source
      }

    /** Where the picker starts when adding a folder: the camera folder of primary shared storage. */
    private fun dcimUri(): Uri =
      DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:DCIM")
  }
}
