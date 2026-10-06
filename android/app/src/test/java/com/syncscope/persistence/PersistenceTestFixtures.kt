package com.syncscope.persistence

import com.syncscope.scan.SortName

fun scanRun(
  runId: String,
  generation: Long,
  configRevision: Long = 1,
  includeHidden: Boolean = false,
  mode: String = "FULL",
) =
  ScanRunEntity(
    runId = runId,
    generation = generation,
    configRevision = configRevision,
    includeHidden = includeHidden,
    phase = "VALIDATING",
    startedAtMillis = 1_000L,
    finishedAtMillis = null,
    terminalState = null,
    errorCode = null,
    errorSummary = null,
    mode = mode,
  )

fun stagingSnapshot(
  snapshotId: String,
  runId: String,
  configRevision: Long = 1,
  remoteListedAtMillis: Long? = null,
) =
  SnapshotEntity(
    snapshotId = snapshotId,
    scanRunId = runId,
    completedAtMillis = null,
    coverage = "COMPLETE",
    configRevision = configRevision,
    includeHidden = false,
    publishable = false,
    remoteListedAtMillis = remoteListedAtMillis,
  )

fun sourceRoot(sourceId: String, canonicalRoot: String = "primary:$sourceId") =
  SourceRootEntity(
    sourceId = sourceId,
    treeUri = "content://com.android.externalstorage.documents/tree/$sourceId",
    authority = "com.android.externalstorage.documents",
    volumeId = "primary",
    documentPath = sourceId,
    canonicalRoot = canonicalRoot,
    alias = "Alias $sourceId",
    canWrite = true,
    addedAtMillis = 1_000L,
  )

fun localNode(
  snapshotId: String,
  sourceId: String,
  entryId: String,
  name: String,
  kind: String = "FILE",
  parentId: String? = null,
  sizeBytes: Long? = 10L,
  modifiedUtcMillis: Long? = 2_000L,
  mimeType: String? = null,
  status: String = "SYNCED",
  issueCode: String? = null,
  sortName: String = SortName.of(name),
) =
  LocalNodeEntity(
    entryId = entryId,
    snapshotId = snapshotId,
    sourceId = sourceId,
    parentId = parentId,
    kind = kind,
    documentUri = "content://provider/doc/$entryId",
    documentId = entryId,
    name = name,
    mimeType = mimeType,
    sizeBytes = sizeBytes,
    modifiedUtcMillis = modifiedUtcMillis,
    precisionMillis = 1L,
    status = status,
    issueCode = issueCode,
    sortName = sortName,
  )
