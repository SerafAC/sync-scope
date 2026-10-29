import { createElement as h, type ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { MD3LightTheme, PaperProvider } from 'react-native-paper';

import type { PreviewParams } from '../../navigation/AppNavigator';
import {
  getBrowsePreferences,
  getLocalImageHandle,
} from '../../native/CloudSync';
import {
  CloudSyncErrorCode,
  FILE_SORTS,
  type FileEntryDto,
  type LocalImageHandleResult,
} from '../../native/CloudSyncContracts';
import { ScanContext, type ScanState } from '../../scan/useScan';
import { PreviewScreen } from '../../screens/PreviewScreen';
import { SelectionProvider } from '../../selection/SelectionProvider';
import { a11ySweep } from '../../test-utils/a11ySweep';
import { FileRow } from '../FileRow';
import { FilesProvider } from '../FilesProvider';
import { MediaThumbnail } from '../MediaThumbnail';
import { TreeView, type TreeViewProps } from '../TreeView';
import type { TreeRow } from '../useTree';
import {
  SORT_LABEL,
  breadcrumbLabel,
  fileRowLabel,
  filterChipLabel,
  folderRowLabel,
  folderToggleLabel,
  galleryTileLabel,
  mediaThumbnailLabel,
  originBadgeLabel,
  placeholderLabel,
  scrollerLabel,
  selectionDetailsLabel,
  selectionLabel,
  sortMenuLabel,
  sortOptionText,
  viewMenuLabel,
} from '../a11y';

// Feature 009 (T084, R021): the sweep below renders the new controls.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
}));

jest.mock('../../native/CloudSync', () => ({
  getBrowsePreferences: jest.fn(),
  setBrowsePreferences: jest.fn(),
  getLocalImageHandle: jest.fn(),
  listSelectableEntries: jest.fn(),
  queryTreeChildren: jest.fn(),
  prepareLocalDeletion: jest.fn(),
  executeLocalDeletion: jest.fn(),
  carrySelection: jest.fn(),
}));

// The Codegen view is a plain host component here.
jest.mock('../../native/specs/SyncScopeVideoViewNativeComponent', () => ({
  __esModule: true,
  default: 'SyncScopeVideoView',
}));

const mockNavigation = {
  goBack: jest.fn(),
  navigate: jest.fn(),
  setOptions: jest.fn(),
};

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
    expect(viewMenuLabel('TREE')).toBe('View: Tree');
  });
});

describe('scrollerLabel and placeholderLabel', () => {
  it('names the scrollbar thumb', () => {
    expect(scrollerLabel()).toBe('Scrollbar');
  });

  it('names a placeholder of a band not read yet', () => {
    expect(placeholderLabel()).toBe('Loading file');
  });
});

describe('mediaThumbnailLabel (009 research R6)', () => {
  it('names the file and its kind, and a known duration', () => {
    expect(mediaThumbnailLabel('Loose.jpg', 'image')).toBe('Loose.jpg, image');
    expect(mediaThumbnailLabel('clip.mp4', 'video')).toBe('clip.mp4, video');
    expect(mediaThumbnailLabel('clip.mp4', 'video', '0:02')).toBe(
      'clip.mp4, video, 0:02',
    );
  });
});

describe('folderToggleLabel (009 research R1)', () => {
  it('says what a tap on the chevron does', () => {
    expect(folderToggleLabel('Album', false)).toBe('Expand Album');
    expect(folderToggleLabel('Album', true)).toBe('Collapse Album');
  });
});

// The sweep (R021, T084): every interactive element of the feature 009
// controls, in each of their states, carries an accessibility label.
describe('accessibility sweep of the feature 009 controls', () => {
  const getLocalImageHandleMock = getLocalImageHandle as jest.MockedFunction<
    typeof getLocalImageHandle
  >;
  const getBrowsePreferencesMock = getBrowsePreferences as jest.MockedFunction<
    typeof getBrowsePreferences
  >;

  function handle(durationMillis: number | null): LocalImageHandleResult {
    return {
      contractVersion: 7,
      status: 'ok',
      handle: { uri: 'file:///cache/thumb.jpg', durationMillis },
    };
  }

  function scanState(snapshotId: string): ScanState {
    return {
      run: null,
      active: { snapshotId } as unknown as ScanState['active'],
      interrupted: null,
      loading: false,
      error: null,
      isRunning: false,
      isStale: false,
      scan: jest.fn(),
      cancel: jest.fn(),
      refresh: jest.fn(),
      dismissError: jest.fn(),
    };
  }

  function providers(child: ReactNode) {
    return h(PaperProvider, {
      theme: MD3LightTheme,
      children: h(ScanContext.Provider, {
        value: scanState('snap-1'),
        children: h(FilesProvider, {
          children: h(SelectionProvider, { children: child }),
        }),
      }),
    });
  }

  function entry(
    name: string,
    overrides: Partial<FileEntryDto> = {},
  ): FileEntryDto {
    return {
      entryId: `e-${name}`,
      sourceId: 's-1',
      parentId: null,
      kind: 'FILE',
      name,
      mimeType: 'image/jpeg',
      sizeBytes: 2048,
      modifiedUtcMillis: 1704067200000,
      status: 'SYNCED',
      issueCode: null,
      nameInOtherSource: false,
      matchingFileCount: null,
      sortName: `1${name.toLowerCase()}`,
      ...overrides,
    };
  }

  const PHOTO = entry('a1.jpg');
  const VIDEO = entry('clip.mp4', {
    mimeType: 'video/mp4',
    status: 'UNSYNCED',
  });
  const DOC = entry('doc.pdf', { mimeType: 'application/pdf' });

  beforeEach(() => {
    jest.clearAllMocks();
    getBrowsePreferencesMock.mockResolvedValue({
      contractVersion: 7,
      status: 'ok',
      preferences: {
        view: 'TREE',
        gallerySort: 'TIME_DESC',
        listSort: 'NAME_ASC',
      },
    });
    getLocalImageHandleMock.mockImplementation((_s, entryId) =>
      Promise.resolve(handle(entryId === VIDEO.entryId ? 2000 : null)),
    );
  });

  describe('TreeView', () => {
    const ROWS: TreeRow[] = [
      {
        kind: 'source',
        key: 'source:s-1',
        depth: 0,
        path: ['s-1'],
        sourceId: 's-1',
        alias: 'Camera',
        counts: null,
        expanded: true,
      },
      {
        kind: 'source',
        key: 'source:s-2',
        depth: 0,
        path: ['s-2'],
        sourceId: 's-2',
        alias: 'Camera (SDCARD)',
        counts: null,
        expanded: false,
      },
      {
        kind: 'folder',
        key: 'folder:s-1/Album',
        depth: 1,
        path: ['s-1', 'Album'],
        entryId: 'd-Album',
        name: 'Album',
        matchingFileCount: 3,
        expanded: true,
      },
      {
        kind: 'folder',
        key: 'folder:s-1/Album/Docs',
        depth: 2,
        path: ['s-1', 'Album', 'Docs'],
        entryId: 'd-Docs',
        name: 'Docs',
        matchingFileCount: 0,
        expanded: false,
      },
      {
        kind: 'placeholder',
        key: 'placeholder:s-1/Album/Docs',
        depth: 3,
        folderPath: ['s-1', 'Album', 'Docs'],
      },
      {
        kind: 'file',
        key: 'file:s-1/Album/a1.jpg',
        depth: 2,
        path: ['s-1', 'Album', 'a1.jpg'],
        entry: PHOTO,
      },
      {
        kind: 'file',
        key: 'file:s-1/Album/clip.mp4',
        depth: 2,
        path: ['s-1', 'Album', 'clip.mp4'],
        entry: VIDEO,
      },
      {
        kind: 'file',
        key: 'file:s-1/Album/doc.pdf',
        depth: 2,
        path: ['s-1', 'Album', 'doc.pdf'],
        entry: DOC,
      },
      {
        kind: 'more',
        key: 'more:s-1/Album',
        depth: 2,
        folderPath: ['s-1', 'Album'],
        nextPageToken: 'tok-2',
      },
    ];

    function renderTree() {
      const tree: TreeViewProps['tree'] = {
        rows: ROWS,
        toggle: jest.fn(),
        loadMore: jest.fn(),
        anchorIndex: null,
        anchorGeneration: 0,
      };
      return render(
        providers(h(TreeView, { filter: 'ALL', snapshotId: 'snap-1', tree })),
      );
    }

    it('labels every source, folder, chevron and file row, before and while selecting', async () => {
      const result = renderTree();
      await screen.findAllByTestId('file-row-thumbnail-image');

      expect(() => a11ySweep(result)).not.toThrow();
      expect(screen.getByLabelText('Collapse Album')).toBeOnTheScreen();
      expect(screen.getByLabelText('Expand Docs')).toBeOnTheScreen();

      fireEvent(screen.getByLabelText('a1.jpg, Synced'), 'longPress');

      expect(
        await screen.findByLabelText('a1.jpg, Synced, selected'),
      ).toBeOnTheScreen();
      expect(() => a11ySweep(result)).not.toThrow();
    });
  });

  describe('FileRow', () => {
    it.each([
      ['a photo', PHOTO],
      ['a video', VIDEO],
      ['a document', DOC],
    ])(
      'labels %s, not selecting, selecting and selected',
      async (_kind, row) => {
        const states = [
          { selected: false, onPress: undefined },
          { selected: false, onPress: jest.fn() },
          { selected: true, onPress: jest.fn() },
        ];
        for (const state of states) {
          const result = render(
            providers(
              h(FileRow, {
                snapshotId: 'snap-1',
                entry: row,
                onLongPress: jest.fn(),
                ...state,
              }),
            ),
          );
          await act(async () => {});

          expect(() => a11ySweep(result)).not.toThrow();
          expect(
            screen.getByLabelText(
              fileRowLabel(row.name, row.status, state.selected),
            ),
          ).toBeOnTheScreen();
          result.unmount();
        }
      },
    );
  });

  describe('MediaThumbnail', () => {
    it('names an image and a video, with its duration, as images', async () => {
      render(
        providers(
          h(MediaThumbnail, {
            snapshotId: 'snap-1',
            entryId: PHOTO.entryId,
            name: PHOTO.name,
            mimeType: PHOTO.mimeType,
            testID: 'photo',
          }),
        ),
      );
      await screen.findByTestId('photo-image');
      const photo = screen.getByTestId('photo');
      expect(photo.props.accessibilityLabel).toBe('a1.jpg, image');
      expect(photo.props.accessibilityRole).toBe('image');

      render(
        providers(
          h(MediaThumbnail, {
            snapshotId: 'snap-1',
            entryId: VIDEO.entryId,
            name: VIDEO.name,
            mimeType: VIDEO.mimeType,
            testID: 'video',
          }),
        ),
      );
      await screen.findByTestId('video-duration');
      const video = screen.getByTestId('video');
      expect(video.props.accessibilityLabel).toBe('clip.mp4, video, 0:02');
      expect(video.props.accessibilityRole).toBe('image');
    });

    it('adds no element of its own to a row that already names the file', async () => {
      render(
        providers(
          h(MediaThumbnail, {
            snapshotId: 'snap-1',
            entryId: PHOTO.entryId,
            name: PHOTO.name,
            mimeType: PHOTO.mimeType,
            testID: 'row-thumb',
            decorative: true,
          }),
        ),
      );
      await screen.findByTestId('row-thumb-image');
      const thumb = screen.getByTestId('row-thumb');
      expect(thumb.props.accessibilityLabel).toBeUndefined();
      expect(thumb.props.accessibilityRole).toBeUndefined();
    });
  });

  describe('PreviewScreen', () => {
    function params(row: FileEntryDto): PreviewParams {
      return {
        snapshotId: 'snap-1',
        entryId: row.entryId,
        name: row.name,
        mimeType: row.mimeType as string,
        sizeBytes: row.sizeBytes as number,
        status: row.status,
      };
    }

    function renderPreview(row: FileEntryDto) {
      return render(
        providers(
          h(PreviewScreen, {
            navigation: mockNavigation as never,
            route: { key: 'preview-1', name: 'Preview', params: params(row) },
          }),
        ),
      );
    }

    it('labels the image preview, unselected and selected', async () => {
      const result = renderPreview(PHOTO);
      await screen.findByTestId('preview-image-full');
      expect(() => a11ySweep(result)).not.toThrow();
      expect(screen.getByLabelText('Back')).toBeOnTheScreen();

      fireEvent.press(screen.getByLabelText('Select this file'));

      expect(
        await screen.findByLabelText('Unselect this file'),
      ).toBeOnTheScreen();
      expect(() => a11ySweep(result)).not.toThrow();
    });

    it('labels the video preview, muted and unmuted, and its error state', async () => {
      const result = renderPreview(VIDEO);
      const video = await screen.findByTestId('preview-video');
      expect(() => a11ySweep(result)).not.toThrow();

      fireEvent.press(screen.getByLabelText('Unmute'));

      expect(await screen.findByLabelText('Mute')).toBeOnTheScreen();
      expect(() => a11ySweep(result)).not.toThrow();

      act(() =>
        video.props.onPlaybackError({ nativeEvent: { reason: 'UNPLAYABLE' } }),
      );

      expect(
        await screen.findByText("This video can't be played"),
      ).toBeOnTheScreen();
      expect(screen.getByLabelText('Go back')).toBeOnTheScreen();
      expect(() => a11ySweep(result)).not.toThrow();
    });

    it('labels the "no longer on the device" state', async () => {
      getLocalImageHandleMock.mockResolvedValue({
        contractVersion: 7,
        status: 'error',
        error: {
          code: CloudSyncErrorCode.IMAGE_UNAVAILABLE,
          message: 'This image could not be read on the device.',
          action: 'Check that the folder is still available, then rescan.',
        },
      });
      const result = renderPreview(PHOTO);

      expect(
        await screen.findByText('This file is no longer on the device'),
      ).toBeOnTheScreen();
      expect(() => a11ySweep(result)).not.toThrow();
    });
  });
});
