import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
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
    ...overrides,
  };
}

function renderTile(e: FileEntryDto, alias: string | undefined) {
  return render(
    <PaperProvider>
      <GalleryTile alias={alias} entry={e} snapshotId="snap-1" />
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
});
