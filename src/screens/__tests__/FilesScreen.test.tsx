import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FilesProvider } from '../../files/FilesProvider';
import { useSourceAliases } from '../../files/useSourceAliases';
import {
  getLocalImageHandle,
  queryFiles,
  queryTreeChildren,
} from '../../native/CloudSync';
import type {
  ActiveSnapshotDto,
  FileEntryDto,
  QueryFilesResult,
  StatusCountDto,
} from '../../native/CloudSyncContracts';
import { useScan, type ScanState } from '../../scan/useScan';
import { a11ySweep } from '../../test-utils/a11ySweep';
import { FilesScreen } from '../FilesScreen';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

jest.mock('../../native/CloudSync', () => ({
  queryFiles: jest.fn(),
  queryTreeChildren: jest.fn(),
  getLocalImageHandle: jest.fn(),
}));
jest.mock('../../scan/useScan', () => ({ useScan: jest.fn() }));
jest.mock('../../files/useSourceAliases', () => ({
  useSourceAliases: jest.fn(),
}));

const queryFilesMock = queryFiles as jest.MockedFunction<typeof queryFiles>;
const queryTreeChildrenMock = queryTreeChildren as jest.MockedFunction<
  typeof queryTreeChildren
>;
const getLocalImageHandleMock = getLocalImageHandle as jest.MockedFunction<
  typeof getLocalImageHandle
>;
const useScanMock = useScan as jest.MockedFunction<typeof useScan>;
const useSourceAliasesMock = useSourceAliases as jest.MockedFunction<
  typeof useSourceAliases
>;

const HIDDEN = { includeHiddenElements: true };

const ALIASES = new Map([['s-1', 'Gallery']]);

const GALLERY_COUNTS: StatusCountDto[] = [
  { status: 'SYNCED', count: 3 },
  { status: 'UNSYNCED', count: 3 },
];
const LIST_COUNTS: StatusCountDto[] = [
  { status: 'SYNCED', count: 3 },
  { status: 'UNSYNCED', count: 4 },
];

function file(entryId: string, name: string): FileEntryDto {
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
  };
}

function ok(
  entries: FileEntryDto[],
  counts: StatusCountDto[],
): QueryFilesResult {
  return {
    contractVersion: 4,
    status: 'ok',
    page: { entries, nextPageToken: null, counts },
  };
}

function scanState(snapshotId: string | null): ScanState {
  return {
    run: null,
    active:
      snapshotId == null
        ? null
        : ({ snapshotId } as unknown as ActiveSnapshotDto),
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

function ui(focused?: boolean) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 360, height: 640 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <PaperProvider>
        <FilesProvider>
          <FilesScreen focused={focused} />
        </FilesProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  useScanMock.mockReturnValue(scanState('snap-1'));
  useSourceAliasesMock.mockReturnValue(ALIASES);
  getLocalImageHandleMock.mockResolvedValue({
    contractVersion: 4,
    status: 'ok',
    handle: { uri: 'file:///cache/t.jpg' },
  });
  queryFilesMock.mockImplementation(async snapshotId =>
    ok([file(`${snapshotId}-e1`, `${snapshotId}.png`)], GALLERY_COUNTS),
  );
  queryTreeChildrenMock.mockImplementation(async () => ok([], LIST_COUNTS));
});

describe('FilesScreen', () => {
  it('opens on the gallery, with the gallery counts on the chips', async () => {
    render(ui());

    expect(screen.getByLabelText('Gallery view')).toBeOnTheScreen();
    expect(screen.getByLabelText('List view')).toBeOnTheScreen();
    expect(await screen.findByLabelText('Filter All, 6')).toBeSelected();
    expect(screen.getByTestId('files-gallery')).toBeVisible();
    expect(screen.getByTestId('files-list', HIDDEN)).not.toBeVisible();
    expect(screen.getByLabelText('snap-1.png, Synced')).toBeVisible();
  });

  it('keeps the filter across a view switch, each view with its own counts (FR-003)', async () => {
    render(ui());
    fireEvent.press(await screen.findByLabelText('Filter Synced, 3'));
    await waitFor(() =>
      expect(queryFilesMock).toHaveBeenLastCalledWith(
        'snap-1',
        expect.objectContaining({ filter: 'SYNCED', view: 'GALLERY' }),
        null,
      ),
    );

    fireEvent.press(screen.getByLabelText('List view'));
    expect(screen.getByTestId('files-list')).toBeVisible();
    expect(screen.getByTestId('files-gallery', HIDDEN)).not.toBeVisible();
    expect(await screen.findByLabelText('Filter All, 7')).not.toBeSelected();
    expect(screen.getByLabelText('Filter Synced, 3')).toBeSelected();
    expect(screen.getByLabelText('Folder Gallery, 3 matching')).toBeVisible();

    fireEvent.press(screen.getByLabelText('Gallery view'));
    expect(await screen.findByLabelText('Filter All, 6')).not.toBeSelected();
    expect(screen.getByLabelText('Filter Synced, 3')).toBeSelected();
    expect(screen.getByTestId('files-gallery')).toBeVisible();
  });

  it('shows "Results updated" once when the snapshot changes', async () => {
    const { rerender } = render(ui());
    await screen.findByLabelText('snap-1.png, Synced');
    expect(screen.queryByText('Results updated')).toBeNull();

    useScanMock.mockReturnValue(scanState('snap-2'));
    rerender(ui());

    expect(await screen.findByLabelText('snap-2.png, Synced')).toBeVisible();
    expect(await screen.findByLabelText('Results updated')).toBeOnTheScreen();
    expect(screen.getAllByText('Results updated')).toHaveLength(1);
    expect(screen.queryByLabelText('snap-1.png, Synced')).toBeNull();
  });

  it('holds the snackbar until the tab is focused', async () => {
    const { rerender } = render(ui(false));
    await screen.findByLabelText('snap-1.png, Synced');

    useScanMock.mockReturnValue(scanState('snap-2'));
    rerender(ui(false));
    await screen.findByLabelText('snap-2.png, Synced');
    await act(async () => {});
    expect(screen.queryByText('Results updated')).toBeNull();

    rerender(ui(true));
    expect(await screen.findByLabelText('Results updated')).toBeOnTheScreen();
  });

  it('shows no snackbar on the first snapshot', async () => {
    useScanMock.mockReturnValue(scanState(null));
    const { rerender } = render(ui());
    expect(screen.getByLabelText('No scan results yet')).toBeOnTheScreen();

    useScanMock.mockReturnValue(scanState('snap-1'));
    rerender(ui());
    await screen.findByLabelText('snap-1.png, Synced');
    await act(async () => {});

    expect(screen.queryByText('Results updated')).toBeNull();
  });

  it('passes the a11y sweep', async () => {
    const result = render(ui());
    await screen.findByLabelText('snap-1.png, Synced');

    expect(() => a11ySweep(result)).not.toThrow();
  });
  describe('before any completed scan (FR-008)', () => {
    it('explains that results appear after a scan and leads to the Scan tab', () => {
      useScanMock.mockReturnValue(scanState(null));
      render(ui());

      const empty = screen.getByLabelText('No scan results yet');
      expect(empty).toBeOnTheScreen();
      expect(screen.getByText('Results appear after a scan.')).toBeOnTheScreen();
      expect(screen.queryByLabelText('Gallery view')).toBeNull();

      fireEvent.press(screen.getByLabelText('Go to Scan'));

      expect(mockNavigate).toHaveBeenCalledWith('Scan');
    });

    it('shows nothing of it while the scan state is still loading', () => {
      useScanMock.mockReturnValue({ ...scanState(null), loading: true });
      render(ui());

      expect(screen.queryByLabelText('Go to Scan')).toBeNull();
      expect(screen.queryByText('Results appear after a scan.')).toBeNull();
    });

    it('shows nothing of it once results exist', async () => {
      render(ui());
      await screen.findByLabelText('snap-1.png, Synced');

      expect(screen.queryByLabelText('Go to Scan')).toBeNull();
      expect(screen.queryByText('Results appear after a scan.')).toBeNull();
    });
  });
});
