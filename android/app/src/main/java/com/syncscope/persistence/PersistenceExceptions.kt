package com.syncscope.persistence

/** A page token does not belong to the snapshot/query it was replayed against. */
class PageTokenMismatchException(message: String) : IllegalArgumentException(message)

/** The requested snapshot does not exist, or has not been published yet. */
class SnapshotNotFoundException(message: String) : IllegalStateException(message)

/** A scan run tried to publish after being superseded, or tried to publish twice. */
class StaleGenerationException(message: String) : IllegalStateException(message)
