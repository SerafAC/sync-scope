package com.syncscope.remote

/**
 * The repository's remote folders as stored in `repository_config.remoteRoots` (research R11): one
 * `\n`-separated string, in the user's order. An existing single folder is a one-element list.
 */
object RemoteRoots {
  private const val SEPARATOR = "\n"

  /** Joins [roots] in order. */
  fun encode(roots: List<String>): String = roots.joinToString(SEPARATOR)

  /** Splits [stored] on `\n`, in order, dropping blank entries. */
  fun decode(stored: String): List<String> = stored.split(SEPARATOR).filter { it.isNotBlank() }
}
