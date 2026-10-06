import type {
  FileFilter,
  FileSort,
  FileStatus,
  FileView,
} from '../native/CloudSyncContracts';
import { FILTER_LABEL, STATUS_LABEL } from '../theme/statusLabels';

// Accessibility labels for the Files tab. Each label is also the control's
// Maestro selector (contracts/maestro-browse.md#selectors), so the text is
// exact and every builder is pure.

/** `Filter All, 6`; just `Filter All` while the count is unknown. */
export function filterChipLabel(
  filter: FileFilter,
  count: number | null,
): string {
  const label = `Filter ${FILTER_LABEL[filter]}`;
  return count == null ? label : `${label}, ${count}`;
}

/**
 * `sunset.png, Unsynced`, plus `, from GalleryTwin` when the tile has an origin
 * badge, then `, selected` while the tile is selected (FR-017).
 */
export function galleryTileLabel(
  name: string,
  status: FileStatus,
  originAlias?: string | null,
  selected = false,
): string {
  const label = fileRowLabel(name, status);
  const withOrigin = originAlias ? `${label}, from ${originAlias}` : label;
  return withSelected(withOrigin, selected);
}

/** `Origin GalleryTwin`. */
export function originBadgeLabel(alias: string): string {
  return `Origin ${alias}`;
}

/**
 * `Folder album, 2 matching`; a dimmed row (0 matching) adds `, no matches`;
 * no count part when the count is unknown (pre-v4 snapshots).
 */
export function folderRowLabel(name: string, matching: number | null): string {
  const label = `Folder ${name}`;
  if (matching == null) {
    return label;
  }
  const counted = `${label}, ${matching} matching`;
  return matching === 0 ? `${counted}, no matches` : counted;
}

/** `sunset.png, Synced`, plus `, selected` while the row is selected (FR-017). */
export function fileRowLabel(
  name: string,
  status: FileStatus,
  selected = false,
): string {
  return withSelected(`${name}, ${STATUS_LABEL[status]}`, selected);
}

function withSelected(label: string, selected: boolean): string {
  return selected ? `${label}, selected` : label;
}

/** `Selection 2 selected, 140 B`; [size] is already formatted (`formatBytes`). */
export function selectionLabel(count: number, size: string): string {
  return `Selection ${count} selected, ${size}`;
}

/** `Selection details 2 hidden by filter`: the selection bar's second line. */
export function selectionDetailsLabel(text: string): string {
  return `Selection details ${text}`;
}

/** `Breadcrumb All folders`. */
export function breadcrumbLabel(name: string): string {
  return `Breadcrumb ${name}`;
}

/**
 * The one table of sort labels (FR-017): the sort menu's option text, and the
 * spoken form the drop-down carries in its accessibility label.
 */
export const SORT_LABEL: Readonly<
  Record<FileSort, { readonly option: string; readonly spoken: string }>
> = {
  NAME_ASC: { option: 'Name (A–Z)', spoken: 'Name, A to Z' },
  NAME_DESC: { option: 'Name (Z–A)', spoken: 'Name, Z to A' },
  TIME_DESC: { option: 'Date (newest first)', spoken: 'Date, newest first' },
  TIME_ASC: { option: 'Date (oldest first)', spoken: 'Date, oldest first' },
  SIZE_DESC: { option: 'Size (largest first)', spoken: 'Size, largest first' },
  SIZE_ASC: { option: 'Size (smallest first)', spoken: 'Size, smallest first' },
};

/** `Size (largest first)`: the option's text in the sort menu. */
export function sortOptionText(sort: FileSort): string {
  return SORT_LABEL[sort].option;
}

/** `Sort: Size, largest first`: the sort drop-down with its current choice. */
export function sortMenuLabel(sort: FileSort): string {
  return `Sort: ${SORT_LABEL[sort].spoken}`;
}

export const VIEW_LABEL: Readonly<Record<FileView, string>> = {
  GALLERY: 'Gallery',
  LIST: 'List',
};

/** `View: Gallery`: the view drop-down with its current choice. */
export function viewMenuLabel(view: FileView): string {
  return `View: ${VIEW_LABEL[view]}`;
}
