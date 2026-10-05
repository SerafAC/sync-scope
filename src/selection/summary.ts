import type {
  FileFilter,
  FileStatus,
  FileView,
} from '../native/CloudSyncContracts';

/** What the selection keeps of one selected `FILE` row (data-model "Selection"). */
export interface SelectionItem {
  /** null when the size is unknown. */
  sizeBytes: number | null;
  status: FileStatus;
  isImage: boolean;
}

export interface SelectionSummary {
  count: number;
  /** The sum of the known sizes. */
  knownBytes: number;
  unknownSizeCount: number;
  /** Selected items the current view and filter do not show. */
  hiddenByFilterCount: number;
}

const FILTER_STATUS: Record<Exclude<FileFilter, 'ALL'>, FileStatus> = {
  SYNCED: 'SYNCED',
  UNSYNCED: 'UNSYNCED',
  ISSUES_UNKNOWN: 'UNKNOWN',
};

/**
 * The derived values the selection bar shows. An item is hidden when its
 * status is not in [filter], or when it is not an image in gallery view.
 * Files in other list folders are not hidden: the user navigated away from
 * them knowingly (research R9).
 */
export function selectionSummary(
  items: ReadonlyMap<string, SelectionItem>,
  view: FileView,
  filter: FileFilter,
): SelectionSummary {
  let knownBytes = 0;
  let unknownSizeCount = 0;
  let hiddenByFilterCount = 0;
  for (const item of items.values()) {
    if (item.sizeBytes == null) {
      unknownSizeCount += 1;
    } else {
      knownBytes += item.sizeBytes;
    }
    const filteredOut =
      filter !== 'ALL' && item.status !== FILTER_STATUS[filter];
    if (filteredOut || (view === 'GALLERY' && !item.isImage)) {
      hiddenByFilterCount += 1;
    }
  }
  return {count: items.size, knownBytes, unknownSizeCount, hiddenByFilterCount};
}
