import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import { FilesProvider } from '../../files/FilesProvider';
import { FilterChips } from '../../files/FilterChips';
import type { FilesViewProps } from '../../files/FilesViewParts';
import { getLocalImageHandle, queryFiles } from '../../native/CloudSync';
import {
  CloudSyncErrorCode,
  type FileEntryDto,
  type QueryFilesResult,
  type StatusCountDto,
} from '../../native/CloudSyncContracts';
import { a11ySweep } from '../../test-utils/a11ySweep';
import { GalleryScreen } from '../GalleryScreen';

jest.mock('../../native/CloudSync', () => ({
  queryFiles: jest.fn(),
  getLocalImageHandle: jest.fn(),
}));

const queryFilesMock = queryFiles as jest.MockedFunction<typeof queryFiles>;
const getLocalImageHandleMock = getLocalImageHandle as jest.MockedFunction<
  typeof getLocalImageHandle
>;

const COUNTS: StatusCountDto[] = [
  { status: 'SYNCED', count: 3 },
  { status: 'UNSYNCED', count: 3 },
];

function file(
  entryId: string,
  name: string,
  overrides: Partial<FileEntryDto> = {},
): FileEntryDto {
  return {
    entryId,
    sourceId: 's-1',
    parentId: null,
    kind: 'FILE',
    name,
    mimeType: 'image/png',
    sizeBytes: 10,
    modifiedUtcMillis: 1704067200000,
    status: 'SYNCED',
    issueCode: null,
    nameInOtherSource: false,
    matchingFileCount: null,
    ...overrides,
  };
}

function page(
  entries: FileEntryDto[],
  nextPageToken: string | null = null,
  counts: StatusCountDto[] | null = COUNTS,
): QueryFilesResult {
  return {
    contractVersion: 4,
    status: 'ok',
    page: { entries, nextPageToken, counts },
  };
}

const ALIASES = new Map([
  ['s-1', 'Gallery'],
  ['s-2', 'GalleryTwin'],
]);

function renderGallery(overrides: Partial<FilesViewProps> = {}) {
  const props: FilesViewProps = {
    snapshotId: 'snap-1',
    scanLoading: false,
    aliases: ALIASES,
    onCountsChange: jest.fn(),
    onSnapshotChange: jest.fn(),
    ...overrides,
  };
  const ui = (p: FilesViewProps) => (
    <PaperProvider>
      <FilesProvider>
        <FilterChips counts={null} />
        <GalleryScreen {...p} />
      </FilesProvider>
    </PaperProvider>
  );
  const result = render(ui(props));
  return {
    ...result,
    props,
    rerenderWith: (next: Partial<FilesViewProps>) =>
      result.rerender(ui({ ...props, ...next })),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  getLocalImageHandleMock.mockResolvedValue({
    contractVersion: 4,
    status: 'ok',
    handle: { uri: 'file:///cache/t.jpg' },
  });
});

describe('GalleryScreen', () => {
  it('reads the gallery newest first under the shared filter and reports the counts', async () => {
    queryFilesMock.mockResolvedValue(
      page([
        file('e-1', 'beach.png'),
        file('e-2', 'sunset.png', {
          sourceId: 's-2',
          status: 'UNSYNCED',
          nameInOtherSource: true,
        }),
      ]),
    );
    const { props } = renderGallery();

    expect(
      await screen.findByLabelText('sunset.png, Unsynced, from GalleryTwin'),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('beach.png, Synced')).toBeOnTheScreen();
    expect(screen.getByLabelText('Origin GalleryTwin')).toBeOnTheScreen();
    expect(queryFilesMock).toHaveBeenCalledWith(
      'snap-1',
      { filter: 'ALL', view: 'GALLERY', sort: 'TIME_DESC', pageSize: 100 },
      null,
    );
    expect(props.onCountsChange).toHaveBeenLastCalledWith(COUNTS);
  });

  it('reads again with the new filter when a chip is pressed', async () => {
    queryFilesMock.mockResolvedValue(page([file('e-1', 'beach.png')]));
    renderGallery();
    await screen.findByLabelText('beach.png, Synced');

    fireEvent.press(screen.getByLabelText('Filter Synced'));

    await waitFor(() =>
      expect(queryFilesMock).toHaveBeenLastCalledWith(
        'snap-1',
        {
          filter: 'SYNCED',
          view: 'GALLERY',
          sort: 'TIME_DESC',
          pageSize: 100,
        },
        null,
      ),
    );
    expect(await screen.findByLabelText('beach.png, Synced')).toBeOnTheScreen();
  });

  it('loads the next page when the end is reached', async () => {
    queryFilesMock
      .mockResolvedValueOnce(page([file('e-1', 'a.png')], 'token-2'))
      .mockResolvedValueOnce(page([file('e-2', 'b.png')], null, null));
    renderGallery();
    await screen.findByLabelText('a.png, Synced');

    fireEvent(screen.getByTestId('gallery-grid'), 'onEndReached');

    expect(await screen.findByLabelText('b.png, Synced')).toBeOnTheScreen();
    expect(screen.getByLabelText('a.png, Synced')).toBeOnTheScreen();
    expect(queryFilesMock).toHaveBeenLastCalledWith(
      'snap-1',
      expect.objectContaining({ view: 'GALLERY' }),
      'token-2',
    );
  });

  it('shows the loading indicator during the first load', async () => {
    queryFilesMock.mockReturnValue(new Promise(() => {}));
    renderGallery();

    expect(screen.getByLabelText('Loading files')).toBeOnTheScreen();
  });

  it('shows the empty state when page 1 is empty', async () => {
    queryFilesMock.mockResolvedValue(page([]));
    renderGallery();

    expect(
      await screen.findByText('No files match this filter'),
    ).toBeOnTheScreen();
  });

  it('shows the no-snapshot state, and reads nothing', async () => {
    const { props } = renderGallery({ snapshotId: null });

    expect(screen.getByText('No scan results yet')).toBeOnTheScreen();
    expect(queryFilesMock).not.toHaveBeenCalled();
    expect(props.onCountsChange).toHaveBeenLastCalledWith(null);
  });

  it('shows loading, not the no-snapshot state, while the scan state is unknown', () => {
    renderGallery({ snapshotId: null, scanLoading: true });

    expect(screen.getByLabelText('Loading files')).toBeOnTheScreen();
    expect(screen.queryByText('No scan results yet')).toBeNull();
  });

  it('shows the error with its action, and Retry reads again', async () => {
    queryFilesMock.mockResolvedValueOnce({
      contractVersion: 4,
      status: 'error',
      error: {
        code: CloudSyncErrorCode.INTERNAL_ERROR,
        message: 'Something went wrong.',
        action: 'Try again.',
      },
    });
    queryFilesMock.mockResolvedValueOnce(page([file('e-1', 'beach.png')]));
    renderGallery();

    expect(
      await screen.findByText('Something went wrong. Try again.'),
    ).toBeOnTheScreen();
    fireEvent.press(screen.getByLabelText('Retry'));

    expect(await screen.findByLabelText('beach.png, Synced')).toBeOnTheScreen();
    expect(queryFilesMock).toHaveBeenCalledTimes(2);
  });

  it('reports a snapshot change once, after the rows were replaced', async () => {
    queryFilesMock.mockResolvedValueOnce(page([file('e-1', 'old.png')]));
    const { props, rerenderWith } = renderGallery();
    await screen.findByLabelText('old.png, Synced');

    queryFilesMock.mockResolvedValueOnce(page([file('e-9', 'new.png')]));
    rerenderWith({ snapshotId: 'snap-2' });

    expect(await screen.findByLabelText('new.png, Synced')).toBeOnTheScreen();
    expect(screen.queryByLabelText('old.png, Synced')).toBeNull();
    await waitFor(() =>
      expect(props.onSnapshotChange).toHaveBeenCalledTimes(1),
    );
  });

  it('passes the a11y sweep', async () => {
    queryFilesMock.mockResolvedValue(
      page([file('e-1', 'sunset.png', { nameInOtherSource: true })]),
    );
    const result = renderGallery();
    await screen.findByLabelText('sunset.png, Synced, from Gallery');

    expect(() => a11ySweep(result)).not.toThrow();
  });
});
