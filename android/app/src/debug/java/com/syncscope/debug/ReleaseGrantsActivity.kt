package com.syncscope.debug

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Debug-only test seam (research R11), reached through `syncscope-debug://release-grants`.
 *
 * Releases every persisted URI grant this app holds and finishes, leaving exactly the OS state
 * a real revocation leaves (the URI is absent from `persistedUriPermissions`) while keeping the
 * Room store intact, which `pm clear` would not. It lives in `src/debug/` only, so the release
 * build does not contain it.
 */
class ReleaseGrantsActivity : Activity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    // Iterate over a snapshot: releasing a grant changes the resolver's list.
    for (permission in contentResolver.persistedUriPermissions.toList()) {
      var flags = 0
      if (permission.isReadPermission) flags = flags or Intent.FLAG_GRANT_READ_URI_PERMISSION
      if (permission.isWritePermission) flags = flags or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
      contentResolver.releasePersistableUriPermission(permission.uri, flags)
    }
    finish()
  }
}
