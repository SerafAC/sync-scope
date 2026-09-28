package com.syncscope.credential

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * The single repository password, held outside Room (R003).
 *
 * Production storage is [EncryptedSharedPreferences] under an Android Keystore
 * `AES256_GCM` [MasterKey], so the file is useless off-device; `allowBackup="false"`
 * keeps it out of backups too. Room only ever sees the `credentialVersion` that
 * [store] returns, and [load] refuses any other version, so a row that points at a
 * rotated or cleared credential is detected instead of silently reusing a password.
 *
 * Nothing here crosses the bridge: the CloudSync spec has no secret getter and must not grow one.
 */
class CredentialStore(private val prefs: () -> SharedPreferences) {

  private val preferences by lazy(prefs)

  /**
   * Stores [password] and returns its new, strictly increasing version. The caller's
   * array is wiped before returning, whatever happens.
   */
  @Synchronized
  fun store(password: CharArray): Long =
    try {
      val version = preferences.getLong(KEY_LAST_VERSION, 0L) + 1
      val committed =
        preferences
          .edit()
          .putString(KEY_PASSWORD, String(password))
          .putLong(KEY_VERSION, version)
          .putLong(KEY_LAST_VERSION, version)
          .commit()
      check(committed) { "Credential write was not committed" }
      version
    } finally {
      password.fill('\u0000')
    }

  /**
   * Returns a fresh copy of the password only when [version] is the one currently stored.
   * The caller owns the array and must wipe it after use.
   */
  @Synchronized
  fun load(version: Long): CharArray? {
    if (!isCurrent(version)) return null
    return preferences.getString(KEY_PASSWORD, null)?.toCharArray()
  }

  /** Whether a password exists for exactly [version]; never reveals the password. */
  @Synchronized
  fun isCurrent(version: Long): Boolean =
    version > 0 &&
      preferences.getLong(KEY_VERSION, 0L) == version &&
      preferences.contains(KEY_PASSWORD)

  /** Removes the password. The version counter survives, so a later [store] never reuses a version. */
  @Synchronized
  fun clear() {
    preferences.edit().remove(KEY_PASSWORD).remove(KEY_VERSION).commit()
  }

  companion object {
    private const val FILE_NAME = "syncscope_credentials"
    private const val KEY_PASSWORD = "repository_password"
    private const val KEY_VERSION = "repository_password_version"
    private const val KEY_LAST_VERSION = "last_issued_version"

    @Volatile private var instance: CredentialStore? = null

    /** Process-wide Keystore-backed store; the preferences open lazily, off the UI thread. */
    fun shared(context: Context): CredentialStore =
      instance
        ?: synchronized(this) {
          instance
            ?: CredentialStore { encryptedPreferences(context.applicationContext) }.also { instance = it }
        }

    @Suppress("DEPRECATION") // security-crypto 1.1.0 deprecates the API but ships no successor.
    private fun encryptedPreferences(context: Context): SharedPreferences {
      val masterKey = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
      return EncryptedSharedPreferences.create(
        context,
        FILE_NAME,
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
      )
    }
  }
}
