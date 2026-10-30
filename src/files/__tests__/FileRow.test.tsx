import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { getLocalImageHandle } from '../../native/CloudSync';
import {
  CloudSyncErrorCode,
  type FileEntryDto,
} from '../../native/CloudSyncContracts';
import { a11ySweep } from '../../test-utils/a11ySweep';
import { density } from '../../theme/spacing';
import {
  FILE_ROW_THUMBNAIL_EDGE_PX,
  FILE_ROW_THUMBNAIL_SIZE,
  FileRow,
  type FileRowProps,
} from '../FileRow';

jest.mock('../../native/CloudSync', () => ({
  getLocalImageHandle: jest.fn(),
}));

const getLocalImageHandleMock = getLocalImageHandle as jest.MockedFunction<
  typeof getLocalImageHandle
>;

function entry(overrides: Partial<FileEntryDto> = {}): FileEntryDto {
  return {
    entryId: 'e-1',
    sourceId: 's-1',
    parentId: null,
    kind: 'FILE',
    name: 'sunset.png',
    mimeType: 'image/png',
    sizeBytes: 2048,
    modifiedUtcMillis: 1704067200000,
    status: 'SYNCED',
    issueCode: null,
    nameInOtherSource: false,
    matchingFileCount: null,
    sortName: '1sunset.png',
    ...overrides,
  };
}

const VIDEO = { entryId: 'v-1', name: 'clip.mp4', mimeType: 'video/mp4' };
const TEXT = { entryId: 't-1', name: 'notes.txt', mimeType: 'text/plain' };

function renderRow(props: Partial<FileRowProps> = {}) {
  return render(
    <PaperProvider>
      <FileRow
        entry={entry()}
        onLongPress={jest.fn()}
        selected={false}
        snapshotId="snap-1"
        {...props}
      />
    </PaperProvider>,
  );
}

function ok(durationMillis: number | null = null) {
  return {
    contractVersion: 7,
    status: 'ok' as const,
    handle: { uri: 'file:///cache/thumbnails/row.jpg', durationMillis },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  getLocalImageHandleMock.mockResolvedValue(ok());
});

describe('FileRow (research R6, FR-005)', () => {
  it('is 40 dp and 128 px for row thumbnails', () => {
    expect(FILE_ROW_THUMBNAIL_SIZE).toBe(40);
    expect(FILE_ROW_THUMBNAIL_EDGE_PX).toBe(128);
    expect(FILE_ROW_THUMBNAIL_SIZE).toBeLessThanOrEqual(density.rowHeight);
  });

  it('shows a 40 dp thumbnail of an image, requested at a 128 px edge', async () => {
    renderRow();

    const row = screen.getByLabelText('sunset.png, Synced');
    await waitFor(() =>
      expect(
        within(row).getByTestId('file-row-thumbnail-image').props.source,
      ).toEqual({ uri: 'file:///cache/thumbnails/row.jpg' }),
    );
    expect(getLocalImageHandleMock).toHaveBeenCalledWith('snap-1', 'e-1', {
      maxEdgePx: FILE_ROW_THUMBNAIL_EDGE_PX,
    });
    const box = StyleSheet.flatten(
      within(row).getByTestId('file-row-thumbnail').props.style,
    );
    expect(box.width).toBe(FILE_ROW_THUMBNAIL_SIZE);
    expect(box.height).toBe(FILE_ROW_THUMBNAIL_SIZE);
    expect(within(row).queryByTestId('file-row-thumbnail-play')).toBeNull();
    expect(within(row).queryByTestId('file-row-icon')).toBeNull();
  });

  it('keeps the fixed row height with a thumbnail', async () => {
    renderRow();

    const row = screen.getByLabelText('sunset.png, Synced');
    expect(StyleSheet.flatten(row.props.style).height).toBe(density.rowHeight);
    await waitFor(() =>
      expect(screen.getByTestId('file-row-thumbnail-image')).toBeOnTheScreen(),
    );
  });

  it('adds a play badge and the duration over a video thumbnail', async () => {
    getLocalImageHandleMock.mockResolvedValue(ok(2000));
    renderRow({ entry: entry(VIDEO) });

    const row = screen.getByLabelText('clip.mp4, Synced');
    await waitFor(() =>
      expect(
        within(row).getByTestId('file-row-thumbnail-play'),
      ).toBeOnTheScreen(),
    );
    expect(
      within(row).getByTestId('file-row-thumbnail-duration'),
    ).toHaveTextContent('0:02');
    expect(getLocalImageHandleMock).toHaveBeenCalledWith('snap-1', 'v-1', {
      maxEdgePx: FILE_ROW_THUMBNAIL_EDGE_PX,
    });
    expect(StyleSheet.flatten(row.props.style).height).toBe(density.rowHeight);
  });

  it('shows the video-off placeholder for a video whose frame cannot be read', async () => {
    getLocalImageHandleMock.mockResolvedValue({
      contractVersion: 7,
      status: 'error',
      error: {
        code: CloudSyncErrorCode.IMAGE_UNAVAILABLE,
        message: 'This image could not be read on the device.',
        action: 'Check that the folder is still available, then rescan.',
      },
    });
    renderRow({ entry: entry(VIDEO) });

    await waitFor(() =>
      expect(
        screen.getByTestId('file-row-thumbnail-video-off'),
      ).toBeOnTheScreen(),
    );
  });

  it('keeps the file icon for other files and reads no thumbnail', () => {
    renderRow({ entry: entry(TEXT) });

    const row = screen.getByLabelText('notes.txt, Synced');
    expect(within(row).getByTestId('file-row-icon')).toBeOnTheScreen();
    expect(within(row).queryByTestId('file-row-thumbnail')).toBeNull();
    expect(getLocalImageHandleMock).not.toHaveBeenCalled();
  });

  it('shows the name, size and modified time', async () => {
    renderRow();

    expect(screen.getByText('sunset.png')).toBeOnTheScreen();
    expect(screen.getByText(/^2 KB · /)).toBeOnTheScreen();
    await waitFor(() =>
      expect(screen.getByTestId('file-row-thumbnail-image')).toBeOnTheScreen(),
    );
  });

  describe('selection (FR-015, FR-017)', () => {
    it.each([
      ['an image', entry(), 'sunset.png, Synced, selected'],
      ['a video', entry(VIDEO), 'clip.mp4, Synced, selected'],
      ['another file', entry(TEXT), 'notes.txt, Synced, selected'],
    ])(
      'shows the check icon and `, selected` on %s, as list view does',
      async (_label, e, label) => {
        renderRow({ entry: e, selected: true });

        const row = screen.getByLabelText(label);
        expect(row).toBeSelected();
        expect(within(row).getByTestId('list-row-selected')).toBeOnTheScreen();
        expect(StyleSheet.flatten(row.props.style).height).toBe(
          density.rowHeight,
        );
        await waitFor(() => expect(row).toBeOnTheScreen());
      },
    );

    it('shows no check icon and is not selected otherwise', async () => {
      renderRow();

      const row = screen.getByLabelText('sunset.png, Synced');
      expect(row).not.toBeSelected();
      expect(screen.queryByTestId('list-row-selected')).toBeNull();
      await waitFor(() =>
        expect(
          screen.getByTestId('file-row-thumbnail-image'),
        ).toBeOnTheScreen(),
      );
    });

    it('reports a long-press, and a tap only when given onPress', async () => {
      const onLongPress = jest.fn();
      const onPress = jest.fn();
      const e = entry();
      const { rerender } = renderRow({ entry: e, onLongPress });

      fireEvent(screen.getByLabelText('sunset.png, Synced'), 'longPress');
      expect(onLongPress).toHaveBeenCalledWith(e);
      fireEvent.press(screen.getByLabelText('sunset.png, Synced'));
      expect(onPress).not.toHaveBeenCalled();

      rerender(
        <PaperProvider>
          <FileRow
            entry={e}
            onLongPress={onLongPress}
            onPress={onPress}
            selected={false}
            snapshotId="snap-1"
          />
        </PaperProvider>,
      );
      fireEvent.press(screen.getByLabelText('sunset.png, Synced'));
      expect(onPress).toHaveBeenCalledWith(e);
      await waitFor(() =>
        expect(
          screen.getByTestId('file-row-thumbnail-image'),
        ).toBeOnTheScreen(),
      );
    });
  });

  it('passes the a11y sweep', async () => {
    getLocalImageHandleMock.mockResolvedValue(ok(2000));
    const result = renderRow({
      entry: entry(VIDEO),
      onPress: jest.fn(),
      selected: true,
    });
    await waitFor(() => expect(screen.getByText('clip.mp4')).toBeOnTheScreen());

    expect(() => a11ySweep(result)).not.toThrow();
  });
});
