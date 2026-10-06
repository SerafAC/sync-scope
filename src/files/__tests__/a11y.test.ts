import { FILE_SORTS } from '../../native/CloudSyncContracts';
import {
  SORT_LABEL,
  breadcrumbLabel,
  fileRowLabel,
  filterChipLabel,
  folderRowLabel,
  galleryTileLabel,
  originBadgeLabel,
  selectionDetailsLabel,
  selectionLabel,
  sortMenuLabel,
  sortOptionText,
  viewMenuLabel,
} from '../a11y';

describe('filterChipLabel', () => {
  it('names the filter and its count', () => {
    expect(filterChipLabel('ALL', 6)).toBe('Filter All, 6');
    expect(filterChipLabel('SYNCED', 3)).toBe('Filter Synced, 3');
    expect(filterChipLabel('UNSYNCED', 0)).toBe('Filter Unsynced, 0');
    expect(filterChipLabel('ISSUES_UNKNOWN', 1)).toBe(
      'Filter Issues or unknown, 1',
    );
  });

  it('omits the count while it is unknown', () => {
    expect(filterChipLabel('ALL', null)).toBe('Filter All');
  });
});

describe('galleryTileLabel', () => {
  it('names the file and its status', () => {
    expect(galleryTileLabel('sunset.png', 'UNSYNCED')).toBe(
      'sunset.png, Unsynced',
    );
    expect(galleryTileLabel('beach.png', 'SYNCED', null)).toBe(
      'beach.png, Synced',
    );
    expect(galleryTileLabel('forest.png', 'UNKNOWN')).toBe(
      'forest.png, Unknown',
    );
  });

  it('adds the origin when the tile has a badge', () => {
    expect(galleryTileLabel('sunset.png', 'UNSYNCED', 'GalleryTwin')).toBe(
      'sunset.png, Unsynced, from GalleryTwin',
    );
  });
});

describe('galleryTileLabel selected', () => {
  it('appends selected when the tile is selected', () => {
    expect(galleryTileLabel('beach.png', 'SYNCED', null, true)).toBe(
      'beach.png, Synced, selected',
    );
    expect(
      galleryTileLabel('sunset.png', 'UNSYNCED', 'GalleryTwin', true),
    ).toBe('sunset.png, Unsynced, from GalleryTwin, selected');
  });

  it('adds nothing when the tile is not selected', () => {
    expect(galleryTileLabel('beach.png', 'SYNCED', null, false)).toBe(
      'beach.png, Synced',
    );
  });
});

describe('originBadgeLabel', () => {
  it('names the origin alias', () => {
    expect(originBadgeLabel('GalleryTwin')).toBe('Origin GalleryTwin');
  });
});

describe('folderRowLabel', () => {
  it('names the folder and its matching count', () => {
    expect(folderRowLabel('album', 2)).toBe('Folder album, 2 matching');
  });

  it('marks a folder without matches', () => {
    expect(folderRowLabel('album', 0)).toBe(
      'Folder album, 0 matching, no matches',
    );
  });

  it('omits the count when it is unknown', () => {
    expect(folderRowLabel('album', null)).toBe('Folder album');
  });
});

describe('fileRowLabel', () => {
  it('names the file and its status', () => {
    expect(fileRowLabel('notes.txt', 'SYNCED')).toBe('notes.txt, Synced');
    expect(fileRowLabel('notes.txt', 'UNSYNCED')).toBe('notes.txt, Unsynced');
    expect(fileRowLabel('notes.txt', 'UNKNOWN')).toBe('notes.txt, Unknown');
  });
});

describe('fileRowLabel selected', () => {
  it('appends selected when the row is selected', () => {
    expect(fileRowLabel('notes.txt', 'SYNCED', true)).toBe(
      'notes.txt, Synced, selected',
    );
    expect(fileRowLabel('notes.txt', 'SYNCED', false)).toBe(
      'notes.txt, Synced',
    );
  });
});

describe('selectionLabel', () => {
  it('names the count and the formatted size', () => {
    expect(selectionLabel(1, '70 B')).toBe('Selection 1 selected, 70 B');
    expect(selectionLabel(37, '1.2 GB')).toBe('Selection 37 selected, 1.2 GB');
  });
});

describe('selectionDetailsLabel', () => {
  it('prefixes the details text', () => {
    expect(selectionDetailsLabel('2 hidden by filter')).toBe(
      'Selection details 2 hidden by filter',
    );
    expect(selectionDetailsLabel('1 of unknown size, 2 hidden by filter')).toBe(
      'Selection details 1 of unknown size, 2 hidden by filter',
    );
  });
});

describe('breadcrumbLabel', () => {
  it('names the crumb', () => {
    expect(breadcrumbLabel('All folders')).toBe('Breadcrumb All folders');
    expect(breadcrumbLabel('Gallery')).toBe('Breadcrumb Gallery');
  });
});

describe('sort labels (FR-017, contracts/maestro-polish.md#selectors)', () => {
  it('gives every sort its option text', () => {
    expect(FILE_SORTS.map(sortOptionText)).toEqual([
      'Name (A–Z)',
      'Name (Z–A)',
      'Date (newest first)',
      'Date (oldest first)',
      'Size (largest first)',
      'Size (smallest first)',
    ]);
  });

  it('labels the sort drop-down with its current choice', () => {
    expect(sortMenuLabel('NAME_ASC')).toBe('Sort: Name, A to Z');
    expect(sortMenuLabel('NAME_DESC')).toBe('Sort: Name, Z to A');
    expect(sortMenuLabel('TIME_DESC')).toBe('Sort: Date, newest first');
    expect(sortMenuLabel('TIME_ASC')).toBe('Sort: Date, oldest first');
    expect(sortMenuLabel('SIZE_DESC')).toBe('Sort: Size, largest first');
    expect(sortMenuLabel('SIZE_ASC')).toBe('Sort: Size, smallest first');
  });

  it('keeps one table entry per sort, all distinct', () => {
    expect(Object.keys(SORT_LABEL).sort()).toEqual([...FILE_SORTS].sort());
    const options = FILE_SORTS.map(sortOptionText);
    const menus = FILE_SORTS.map(sortMenuLabel);
    expect(new Set(options).size).toBe(6);
    expect(new Set(menus).size).toBe(6);
  });
});

describe('viewMenuLabel', () => {
  it('labels the view drop-down with its current choice', () => {
    expect(viewMenuLabel('GALLERY')).toBe('View: Gallery');
    expect(viewMenuLabel('LIST')).toBe('View: List');
  });
});
