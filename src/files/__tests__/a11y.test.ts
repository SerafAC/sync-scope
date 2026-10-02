import {
  breadcrumbLabel,
  fileRowLabel,
  filterChipLabel,
  folderRowLabel,
  galleryTileLabel,
  originBadgeLabel,
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

describe('breadcrumbLabel', () => {
  it('names the crumb', () => {
    expect(breadcrumbLabel('All folders')).toBe('Breadcrumb All folders');
    expect(breadcrumbLabel('Gallery')).toBe('Breadcrumb Gallery');
  });
});
