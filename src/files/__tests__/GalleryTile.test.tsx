import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { getLocalImageHandle } from '../../native/CloudSync';
import {
  CloudSyncErrorCode,
  type FileEntryDto,
} from '../../native/CloudSyncContracts';
import { a11ySweep } from '../../test-utils/a11ySweep';
import { density, gridColumns } from '../../theme/spacing';
import { GalleryTile, galleryTileSize } from '../GalleryTile';

jest.mock('../../native/CloudSync', () => ({
  getLocalImageHandle: jest.fn(),
}));

const getLocalImageHandleMock = getLocalImageHandle as jest.MockedFunction<
  typeof getLocalImageHandle
>;

function entry(overrides: Partial<FileEntryDto> = {}): FileEntryDto {
  return {
    entryId: 'e-1',
    sourceId: 's-2',
    parentId: null,
    kind: 'FILE',
    name: 'sunset.png',
    mimeType: 'image/png',
    sizeBytes: 100,
    modifiedUtcMillis: 1704067200000,
    status: 'UNSYNCED',
    issueCode: null,
    nameInOtherSource: false,
    matchingFileCount: null,
    sortName: '1sunset.png',
    ...overrides,
  };
}

function renderTile(
  e: FileEntryDto,
  alias: string | undefined,
  selection: {
    selected?: boolean;
    onPress?: (entry: FileEntryDto) => void;
    onLongPress?: (entry: FileEntryDto) => void;
  } = {},
) {
  return render(
    <PaperProvider>
      <GalleryTile alias={alias} entry={e} snapshotId="snap-1" {...selection} />
    </PaperProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  getLocalImageHandleMock.mockResolvedValue({
    contractVersion: 4,
    status: 'ok',
    handle: { uri: 'file:///cache/thumbnails/a.jpg' },
  });
});

describe('galleryTileSize', () => {
  it('splits the width into gridColumns squares with tile gaps', () => {
    expect(galleryTileSize(362)).toBe(
      (362 - (gridColumns - 1) * density.tileGap) / gridColumns,
    );
  });
});

describe('GalleryTile', () => {
  it('shows no badge when the name is in no other source', async () => {
    renderTile(entry(), 'GalleryTwin');

    expect(screen.getByLabelText('sunset.png, Unsynced')).toBeOnTheScreen();
    expect(screen.queryByTestId('gallery-tile-badge')).toBeNull();
    expect(screen.queryByLabelText(/^Origin /)).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('gallery-tile-image')).toBeOnTheScreen(),
    );
  });

  it('shows the source alias as an origin badge on a name twin', async () => {
    renderTile(entry({ nameInOtherSource: true }), 'GalleryTwin');

    expect(
      screen.getByLabelText('sunset.png, Unsynced, from GalleryTwin'),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('Origin GalleryTwin')).toHaveTextContent(
      'GalleryTwin',
    );
    await waitFor(() =>
      expect(screen.getByTestId('gallery-tile-image')).toBeOnTheScreen(),
    );
  });

  it('shows no badge while the alias is not known', async () => {
    renderTile(entry({ nameInOtherSource: true }), undefined);

    expect(screen.getByLabelText('sunset.png, Unsynced')).toBeOnTheScreen();
    expect(screen.queryByTestId('gallery-tile-badge')).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('gallery-tile-image')).toBeOnTheScreen(),
    );
  });

  it('shows a placeholder while loading, then the thumbnail and the status', async () => {
    renderTile(entry({ status: 'SYNCED' }), 'Gallery');

    expect(screen.getByTestId('gallery-tile-placeholder')).toBeOnTheScreen();
    expect(screen.getByText('Synced')).toBeOnTheScreen();
    await waitFor(() =>
      expect(screen.getByTestId('gallery-tile-image').props.source).toEqual({
        uri: 'file:///cache/thumbnails/a.jpg',
      }),
    );
    expect(screen.queryByTestId('gallery-tile-placeholder')).toBeNull();
  });

  it('shows the broken-image state when the image cannot be read', async () => {
    getLocalImageHandleMock.mockResolvedValue({
      contractVersion: 4,
      status: 'error',
      error: {
        code: CloudSyncErrorCode.IMAGE_UNAVAILABLE,
        message: 'This image could not be read on the device.',
        action: 'Check that the folder is still available, then rescan.',
      },
    });
    renderTile(entry(), 'Gallery');

    await waitFor(() =>
      expect(screen.getByTestId('gallery-tile-broken')).toBeOnTheScreen(),
    );
    expect(screen.queryByTestId('gallery-tile-image')).toBeNull();
    expect(screen.getByLabelText('sunset.png, Unsynced')).toBeOnTheScreen();
  });

  it('passes the a11y sweep', async () => {
    const result = renderTile(entry({ nameInOtherSource: true }), 'Gallery');
    await waitFor(() =>
      expect(screen.getByTestId('gallery-tile-image')).toBeOnTheScreen(),
    );

    expect(() => a11ySweep(result)).not.toThrow();
  });

  describe('selection (FR-015, FR-017)', () => {
    it('reports a long-press with its entry', async () => {
      const onLongPress = jest.fn();
      const e = entry();
      renderTile(e, 'Gallery', { onLongPress });

      fireEvent(screen.getByLabelText('sunset.png, Unsynced'), 'longPress');

      expect(onLongPress).toHaveBeenCalledWith(e);
      await waitFor(() =>
        expect(screen.getByTestId('gallery-tile-image')).toBeOnTheScreen(),
      );
    });

    it('reports a tap only when given onPress', async () => {
      const onPress = jest.fn();
      const e = entry();
      const { rerender } = renderTile(e, 'Gallery');
      fireEvent.press(screen.getByLabelText('sunset.png, Unsynced'));
      expect(onPress).not.toHaveBeenCalled();

      rerender(
        <PaperProvider>
          <GalleryTile
            alias="Gallery"
            entry={e}
            onPress={onPress}
            snapshotId="snap-1"
          />
        </PaperProvider>,
      );
      fireEvent.press(screen.getByLabelText('sunset.png, Unsynced'));

      expect(onPress).toHaveBeenCalledWith(e);
      await waitFor(() =>
        expect(screen.getByTestId('gallery-tile-image')).toBeOnTheScreen(),
      );
    });

    it('shows a check mark, the selected state and `, selected` when selected', async () => {
      renderTile(entry({ nameInOtherSource: true }), 'Gallery', {
        selected: true,
      });

      const tile = screen.getByLabelText(
        'sunset.png, Unsynced, from Gallery, selected',
      );
      expect(tile).toBeSelected();
      expect(screen.getByTestId('gallery-tile-selected')).toBeOnTheScreen();
      await waitFor(() =>
        expect(screen.getByTestId('gallery-tile-image')).toBeOnTheScreen(),
      );
    });

    it('shows no check mark and is not selected otherwise', async () => {
      renderTile(entry(), 'Gallery');

      expect(screen.getByLabelText('sunset.png, Unsynced')).not.toBeSelected();
      expect(screen.queryByTestId('gallery-tile-selected')).toBeNull();
      await waitFor(() =>
        expect(screen.getByTestId('gallery-tile-image')).toBeOnTheScreen(),
      );
    });

    it('keeps the tile size when selected, so getItemLayout stays valid', async () => {
      const { rerender } = renderTile(entry(), 'Gallery');
      const before = StyleSheet.flatten(
        screen.getByTestId('gallery-tile-e-1').props.style,
      );

      rerender(
        <PaperProvider>
          <GalleryTile
            alias="Gallery"
            entry={entry()}
            selected
            snapshotId="snap-1"
          />
        </PaperProvider>,
      );
      const after = StyleSheet.flatten(
        screen.getByTestId('gallery-tile-e-1').props.style,
      );

      expect(after.width).toBe(before.width);
      expect(after.height).toBe(before.height);
      await waitFor(() =>
        expect(screen.getByTestId('gallery-tile-image')).toBeOnTheScreen(),
      );
    });

    it('passes the a11y sweep while selected', async () => {
      const result = renderTile(entry(), 'Gallery', {
        selected: true,
        onPress: jest.fn(),
        onLongPress: jest.fn(),
      });
      await waitFor(() =>
        expect(screen.getByTestId('gallery-tile-image')).toBeOnTheScreen(),
      );

      expect(() => a11ySweep(result)).not.toThrow();
    });
  });
});
