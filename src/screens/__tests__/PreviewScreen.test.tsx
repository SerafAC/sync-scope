import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { FilesProvider } from '../../files/FilesProvider';
import type { PreviewParams } from '../../navigation/AppNavigator';
import {
  executeLocalDeletion,
  getBrowsePreferences,
  getLocalImageHandle,
  prepareLocalDeletion,
} from '../../native/CloudSync';
import {
  CloudSyncErrorCode,
  type LocalImageHandleResult,
} from '../../native/CloudSyncContracts';
import { ScanContext, type ScanState } from '../../scan/useScan';
import { SelectionProvider } from '../../selection/SelectionProvider';
import { a11ySweep } from '../../test-utils/a11ySweep';
import { PreviewScreen } from '../PreviewScreen';

jest.mock('@react-navigation/native', () => ({
  // DeleteFlow re-provides NavigationContext inside its Portal.
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
}));

jest.mock('../../native/CloudSync', () => ({
  getBrowsePreferences: jest.fn(),
  setBrowsePreferences: jest.fn(),
  getLocalImageHandle: jest.fn(),
  listSelectableEntries: jest.fn(),
  prepareLocalDeletion: jest.fn(),
  executeLocalDeletion: jest.fn(),
  // Phase 8 (T075): the preview follows its file into a new snapshot.
  carrySelection: jest.fn(),
}));

// The Codegen view is a plain host component here: its props are what we assert.
jest.mock('../../native/specs/SyncScopeVideoViewNativeComponent', () => ({
  __esModule: true,
  default: 'SyncScopeVideoView',
}));

const mockNavigation = {
  goBack: jest.fn(),
  navigate: jest.fn(),
  setOptions: jest.fn(),
};

const getLocalImageHandleMock = getLocalImageHandle as jest.MockedFunction<
  typeof getLocalImageHandle
>;
const getBrowsePreferencesMock = getBrowsePreferences as jest.MockedFunction<
  typeof getBrowsePreferences
>;
const prepareLocalDeletionMock = prepareLocalDeletion as jest.MockedFunction<
  typeof prepareLocalDeletion
>;
const executeLocalDeletionMock = executeLocalDeletion as jest.MockedFunction<
  typeof executeLocalDeletion
>;
const carrySelectionMock = (
  jest.requireMock('../../native/CloudSync') as { carrySelection: jest.Mock }
).carrySelection;

const IMAGE: PreviewParams = {
  snapshotId: 'snap-1',
  entryId: 'e-1',
  name: 'Loose.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 2000,
  status: 'SYNCED',
};

const VIDEO: PreviewParams = {
  snapshotId: 'snap-1',
  entryId: 'v-1',
  name: 'clip.mp4',
  mimeType: 'video/mp4',
  sizeBytes: 4096,
  status: 'UNSYNCED',
};

const THUMB_URI = 'file:///cache/thumb-256.jpg';
const FULL_URI = 'file:///cache/full.jpg';

function handle(uri: string): LocalImageHandleResult {
  return {
    contractVersion: 7,
    status: 'ok',
    handle: { uri, durationMillis: null },
  };
}

function scanState(snapshotId: string | null): ScanState {
  return {
    run: null,
    active:
      snapshotId == null
        ? null
        : ({ snapshotId } as unknown as ScanState['active']),
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

function renderPreview(params: PreviewParams = IMAGE) {
  const ui = (activeSnapshotId: string) => (
    <PaperProvider>
      <ScanContext.Provider value={scanState(activeSnapshotId)}>
        <FilesProvider>
          <SelectionProvider>
            <PreviewScreen
              navigation={mockNavigation as never}
              route={{ key: 'preview-1', name: 'Preview', params }}
            />
          </SelectionProvider>
        </FilesProvider>
      </ScanContext.Provider>
    </PaperProvider>
  );
  const result = render(ui(params.snapshotId));
  return {
    ...result,
    /** A new scan result became the active snapshot. */
    newSnapshot: (snapshotId: string) => result.rerender(ui(snapshotId)),
  };
}

/** Resolves the full-size read on demand; the 256 px thumbnail answers at once. */
function deferFullImage(): (result: LocalImageHandleResult) => void {
  let resolveFull: (result: LocalImageHandleResult) => void = () => {};
  getLocalImageHandleMock.mockImplementation((_s, _e, spec) =>
    spec.maxEdgePx === 256
      ? Promise.resolve(handle(THUMB_URI))
      : new Promise(resolve => {
          resolveFull = resolve;
        }),
  );
  return result => resolveFull(result);
}

const WINDOW = Dimensions.get('window');
const SCREEN = Dimensions.get('screen');

function setWindow(width: number, height: number, scale: number) {
  const dims = { width, height, scale, fontScale: 1 };
  act(() => Dimensions.set({ window: dims, screen: dims }));
}

beforeEach(() => {
  jest.clearAllMocks();
  getBrowsePreferencesMock.mockResolvedValue({
    contractVersion: 7,
    status: 'ok',
    preferences: {
      view: 'GALLERY',
      gallerySort: 'TIME_DESC',
      listSort: 'NAME_ASC',
    },
  });
  getLocalImageHandleMock.mockImplementation((_s, _e, spec) =>
    Promise.resolve(handle(spec.maxEdgePx === 256 ? THUMB_URI : FULL_URI)),
  );
});

afterEach(() => {
  act(() => Dimensions.set({ window: WINDOW, screen: SCREEN }));
});

describe('PreviewScreen', () => {
  describe('image', () => {
    it('shows the cached thumbnail first, then the image at the long edge in physical pixels', async () => {
      setWindow(400, 700, 2);
      const finish = deferFullImage();
      renderPreview();

      const thumb = await screen.findByTestId('preview-image-thumbnail');
      expect(thumb.props.source).toEqual({ uri: THUMB_URI });
      expect(thumb.props.resizeMode).toBe('contain');
      expect(screen.getByTestId('preview-image')).toBeOnTheScreen();
      expect(screen.queryByTestId('preview-image-full')).toBeNull();
      expect(getLocalImageHandleMock).toHaveBeenCalledWith('snap-1', 'e-1', {
        maxEdgePx: 256,
      });
      // 700 dp × 2 = 1400 px, under the 2048 px cap.
      expect(getLocalImageHandleMock).toHaveBeenCalledWith('snap-1', 'e-1', {
        maxEdgePx: 1400,
      });

      await act(async () => finish(handle(FULL_URI)));

      const full = await screen.findByTestId('preview-image-full');
      expect(full.props.source).toEqual({ uri: FULL_URI });
      expect(full.props.resizeMode).toBe('contain');
      expect(screen.queryByTestId('preview-image-thumbnail')).toBeNull();
    });

    it('clamps the edge by the 2048 px cap', async () => {
      setWindow(800, 1400, 3);
      renderPreview();

      await screen.findByTestId('preview-image-full');
      expect(getLocalImageHandleMock).toHaveBeenCalledWith('snap-1', 'e-1', {
        maxEdgePx: 2048,
      });
    });

    it('shows "This file is no longer on the device" and a Back button for IMAGE_UNAVAILABLE', async () => {
      getLocalImageHandleMock.mockResolvedValue({
        contractVersion: 7,
        status: 'error',
        error: {
          code: CloudSyncErrorCode.IMAGE_UNAVAILABLE,
          message: 'This image could not be read on the device.',
          action: 'Check that the folder is still available, then rescan.',
        },
      });
      renderPreview();

      expect(
        await screen.findByText('This file is no longer on the device'),
      ).toBeOnTheScreen();
      expect(screen.queryByTestId('preview-image-full')).toBeNull();
      fireEvent.press(screen.getByLabelText('Go back'));
      expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
    });

    it('has a back action and the file name in its top bar', async () => {
      renderPreview();
      await screen.findByTestId('preview-image-full');

      expect(screen.getByText('Loose.jpg')).toBeOnTheScreen();
      fireEvent.press(screen.getByLabelText('Back'));
      expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
    });

    it('passes the a11y sweep', async () => {
      const result = renderPreview();
      await screen.findByTestId('preview-image-full');

      expect(() => a11ySweep(result)).not.toThrow();
    });
  });

  describe('video', () => {
    it('renders SyncScopeVideoView muted, and the mute toggle flips muted', async () => {
      renderPreview(VIDEO);

      const video = await screen.findByTestId('preview-video');
      expect(video.props.snapshotId).toBe('snap-1');
      expect(video.props.entryId).toBe('v-1');
      expect(video.props.muted).toBe(true);
      expect(video.props.paused).toBe(false);
      // No document URI is read in JavaScript: the view resolves it natively.
      expect(getLocalImageHandleMock).not.toHaveBeenCalledWith(
        'snap-1',
        'v-1',
        expect.objectContaining({ maxEdgePx: expect.any(Number) }) as never,
      );

      fireEvent.press(screen.getByLabelText('Unmute'));
      expect(screen.getByTestId('preview-video').props.muted).toBe(false);

      fireEvent.press(screen.getByLabelText('Mute'));
      expect(screen.getByTestId('preview-video').props.muted).toBe(true);
    });

    it('shows "This video can\'t be played" and a Back button on onPlaybackError', async () => {
      renderPreview(VIDEO);
      const video = await screen.findByTestId('preview-video');

      act(() =>
        video.props.onPlaybackError({ nativeEvent: { reason: 'UNPLAYABLE' } }),
      );

      expect(
        await screen.findByText("This video can't be played"),
      ).toBeOnTheScreen();
      expect(screen.queryByTestId('preview-video')).toBeNull();
      fireEvent.press(screen.getByLabelText('Go back'));
      expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
    });

    it('passes the a11y sweep', async () => {
      const result = renderPreview(VIDEO);
      await screen.findByTestId('preview-video');

      expect(() => a11ySweep(result)).not.toThrow();
    });
  });

  describe('selection (research R11, T043)', () => {
    it('toggles the file with "Select this file" / "Unselect this file"', async () => {
      renderPreview();
      await screen.findByTestId('preview-image-full');
      expect(screen.queryByTestId('selection-bar')).toBeNull();

      fireEvent.press(screen.getByLabelText('Select this file'));

      expect(
        await screen.findByLabelText('Unselect this file'),
      ).toBeOnTheScreen();
      expect(screen.getByTestId('selection-bar')).toBeOnTheScreen();
      expect(screen.getByText('1 selected · 2 kB')).toBeOnTheScreen();

      fireEvent.press(screen.getByLabelText('Unselect this file'));

      expect(
        await screen.findByLabelText('Select this file'),
      ).toBeOnTheScreen();
      expect(screen.queryByTestId('selection-bar')).toBeNull();
    });

    it('shows the selection bar with Delete whenever something is selected', async () => {
      renderPreview(VIDEO);
      await screen.findByTestId('preview-video');
      fireEvent.press(screen.getByLabelText('Select this file'));

      expect(await screen.findByTestId('selection-bar')).toBeOnTheScreen();
      expect(screen.getByLabelText('Delete selected')).toBeOnTheScreen();
    });

    it('deletes through the DeleteFlow and closes after a deletion that removed the previewed file', async () => {
      prepareLocalDeletionMock.mockResolvedValue({
        contractVersion: 7,
        status: 'ok',
        plan: {
          planToken: 'tok-1',
          toDelete: { count: 1, bytes: 2000 },
          unsynced: { count: 0, bytes: 0 },
          refused: { count: 0, scanTooOld: 0 },
          movedByRecheck: 0,
          missing: 0,
          unknownSizeCount: 0,
          remoteListedAtMillis: Date.now(),
        },
      });
      executeLocalDeletionMock.mockResolvedValue({
        contractVersion: 7,
        status: 'ok',
        result: {
          deleted: 1,
          freedBytes: 2000,
          failures: [],
          removedEntryIds: ['e-1'],
        },
      });
      renderPreview();
      await screen.findByTestId('preview-image-full');
      fireEvent.press(screen.getByLabelText('Select this file'));
      fireEvent.press(await screen.findByLabelText('Delete selected'));

      expect(prepareLocalDeletionMock).toHaveBeenCalledWith('snap-1', ['e-1']);
      await screen.findByLabelText('Delete 1 backed-up files, 2 kB');
      fireEvent.press(screen.getByLabelText('Delete'));
      fireEvent.press(await screen.findByLabelText('Done'));

      await waitFor(() => expect(mockNavigation.goBack).toHaveBeenCalled());
    });

    it('stays open after a deletion that did not remove the previewed file', async () => {
      prepareLocalDeletionMock.mockResolvedValue({
        contractVersion: 7,
        status: 'ok',
        plan: {
          planToken: 'tok-2',
          toDelete: { count: 1, bytes: 2000 },
          unsynced: { count: 0, bytes: 0 },
          refused: { count: 0, scanTooOld: 0 },
          movedByRecheck: 0,
          missing: 0,
          unknownSizeCount: 0,
          remoteListedAtMillis: Date.now(),
        },
      });
      executeLocalDeletionMock.mockResolvedValue({
        contractVersion: 7,
        status: 'ok',
        result: {
          deleted: 0,
          freedBytes: 0,
          failures: [{ entryId: 'e-1', name: 'Loose.jpg', reason: 'FAILED' }],
          removedEntryIds: [],
        },
      });
      renderPreview();
      await screen.findByTestId('preview-image-full');
      fireEvent.press(screen.getByLabelText('Select this file'));
      fireEvent.press(await screen.findByLabelText('Delete selected'));
      await screen.findByLabelText('Delete 1 backed-up files, 2 kB');
      fireEvent.press(screen.getByLabelText('Delete'));
      await waitFor(() => expect(executeLocalDeletionMock).toHaveBeenCalled());

      expect(mockNavigation.goBack).not.toHaveBeenCalled();
      expect(screen.getByTestId('preview-image')).toBeOnTheScreen();
    });
  });

  describe('a new snapshot while open (research R8, T077)', () => {
    it('keeps the file when it is carried into the new snapshot', async () => {
      carrySelectionMock.mockResolvedValue({
        contractVersion: 7,
        status: 'ok',
        carried: [{ from: 'e-1', to: 'e-9' }],
        dropped: 0,
      });
      const { newSnapshot } = renderPreview();
      await screen.findByTestId('preview-image-full');

      newSnapshot('snap-2');

      await waitFor(() =>
        expect(carrySelectionMock).toHaveBeenCalledWith('snap-1', 'snap-2', [
          'e-1',
        ]),
      );
      await waitFor(() =>
        expect(getLocalImageHandleMock).toHaveBeenCalledWith(
          'snap-2',
          'e-9',
          expect.anything(),
        ),
      );
      expect(screen.getByTestId('preview-image')).toBeOnTheScreen();
      expect(
        screen.queryByText(
          'This file changed. Go back to see the latest results.',
        ),
      ).toBeNull();
    });

    it('shows "This file changed. Go back to see the latest results." when it is not carried', async () => {
      carrySelectionMock.mockResolvedValue({
        contractVersion: 7,
        status: 'ok',
        carried: [],
        dropped: 1,
      });
      const { newSnapshot } = renderPreview();
      await screen.findByTestId('preview-image-full');

      newSnapshot('snap-2');

      expect(
        await screen.findByText(
          'This file changed. Go back to see the latest results.',
        ),
      ).toBeOnTheScreen();
      fireEvent.press(screen.getByLabelText('Go back'));
      expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
    });
  });
});
