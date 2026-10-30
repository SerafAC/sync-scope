import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { getLocalImageHandle } from '../../native/CloudSync';
import {
  CloudSyncErrorCode,
  GALLERY_THUMBNAIL_EDGE_PX,
  type LocalImageHandleResult,
} from '../../native/CloudSyncContracts';
import { MediaThumbnail, type MediaThumbnailProps } from '../MediaThumbnail';

jest.mock('../../native/CloudSync', () => ({
  getLocalImageHandle: jest.fn(),
}));

const getLocalImageHandleMock = getLocalImageHandle as jest.MockedFunction<
  typeof getLocalImageHandle
>;

function ok(durationMillis: number | null = null): LocalImageHandleResult {
  return {
    contractVersion: 7,
    status: 'ok',
    handle: { uri: 'file:///cache/thumbnails/t.jpg', durationMillis },
  };
}

function unavailable(): LocalImageHandleResult {
  return {
    contractVersion: 7,
    status: 'error',
    error: {
      code: CloudSyncErrorCode.IMAGE_UNAVAILABLE,
      message: 'This image could not be read on the device.',
      action: 'Check that the folder is still available, then rescan.',
    },
  };
}

const IMAGE = {
  entryId: 'e-1',
  name: 'sunset.png',
  mimeType: 'image/png',
};

const VIDEO = {
  entryId: 'v-1',
  name: 'clip.mp4',
  mimeType: 'video/mp4',
};

function renderThumbnail(props: Partial<MediaThumbnailProps> = {}) {
  return render(
    <PaperProvider>
      <MediaThumbnail
        {...IMAGE}
        snapshotId="snap-1"
        testID="thumb"
        {...props}
      />
    </PaperProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  getLocalImageHandleMock.mockResolvedValue(ok());
});

describe('MediaThumbnail', () => {
  it('renders the local thumbnail of an image, with no play badge', async () => {
    renderThumbnail();

    expect(screen.getByTestId('thumb-placeholder')).toBeOnTheScreen();
    await waitFor(() =>
      expect(screen.getByTestId('thumb-image').props.source).toEqual({
        uri: 'file:///cache/thumbnails/t.jpg',
      }),
    );
    expect(screen.queryByTestId('thumb-placeholder')).toBeNull();
    expect(screen.queryByTestId('thumb-play')).toBeNull();
    expect(screen.queryByTestId('thumb-duration')).toBeNull();
    expect(getLocalImageHandleMock).toHaveBeenCalledWith('snap-1', 'e-1', {
      maxEdgePx: GALLERY_THUMBNAIL_EDGE_PX,
    });
  });

  it('asks for the requested edge and draws at the requested size', async () => {
    renderThumbnail({ edge: 128, size: 40 });

    await waitFor(() =>
      expect(screen.getByTestId('thumb-image')).toBeOnTheScreen(),
    );
    expect(getLocalImageHandleMock).toHaveBeenCalledWith('snap-1', 'e-1', {
      maxEdgePx: 128,
    });
    const box = StyleSheet.flatten(screen.getByTestId('thumb').props.style);
    expect(box.width).toBe(40);
    expect(box.height).toBe(40);
  });

  it('shows the broken-image state when an image cannot be read', async () => {
    getLocalImageHandleMock.mockResolvedValue(unavailable());
    renderThumbnail();

    await waitFor(() =>
      expect(screen.getByTestId('thumb-broken')).toBeOnTheScreen(),
    );
    expect(screen.queryByTestId('thumb-image')).toBeNull();
    expect(screen.queryByTestId('thumb-video-off')).toBeNull();
  });

  it('adds a play badge and the formatted duration over a video', async () => {
    getLocalImageHandleMock.mockResolvedValue(ok(2000));
    renderThumbnail(VIDEO);

    await waitFor(() =>
      expect(screen.getByTestId('thumb-image')).toBeOnTheScreen(),
    );
    expect(screen.getByTestId('thumb-play')).toBeOnTheScreen();
    expect(screen.getByTestId('thumb-duration')).toHaveTextContent('0:02');
  });

  it('formats an hour-long video as h:mm:ss', async () => {
    getLocalImageHandleMock.mockResolvedValue(ok(3_723_000));
    renderThumbnail(VIDEO);

    await waitFor(() =>
      expect(screen.getByTestId('thumb-duration')).toHaveTextContent('1:02:03'),
    );
  });

  it('shows the play badge but no duration when it is null', async () => {
    getLocalImageHandleMock.mockResolvedValue(ok(null));
    renderThumbnail(VIDEO);

    await waitFor(() =>
      expect(screen.getByTestId('thumb-image')).toBeOnTheScreen(),
    );
    expect(screen.getByTestId('thumb-play')).toBeOnTheScreen();
    expect(screen.queryByTestId('thumb-duration')).toBeNull();
  });

  it('shows the video-off placeholder when a video frame cannot be read', async () => {
    getLocalImageHandleMock.mockResolvedValue(unavailable());
    renderThumbnail(VIDEO);

    await waitFor(() =>
      expect(screen.getByTestId('thumb-video-off')).toBeOnTheScreen(),
    );
    expect(screen.queryByTestId('thumb-broken')).toBeNull();
    expect(screen.queryByTestId('thumb-image')).toBeNull();
    expect(screen.queryByTestId('thumb-duration')).toBeNull();
  });

  it('names the file and says it is a video in its accessibility label', async () => {
    getLocalImageHandleMock.mockResolvedValue(ok(2000));
    renderThumbnail(VIDEO);

    await waitFor(() =>
      expect(screen.getByTestId('thumb-duration')).toBeOnTheScreen(),
    );
    expect(screen.getByLabelText('clip.mp4, video, 0:02')).toBeOnTheScreen();
  });

  it('says a video is a video before its duration is known', () => {
    getLocalImageHandleMock.mockReturnValue(new Promise(() => {}));
    renderThumbnail(VIDEO);

    expect(screen.getByLabelText('clip.mp4, video')).toBeOnTheScreen();
  });

  it('names an image as an image', async () => {
    renderThumbnail();

    expect(screen.getByLabelText('sunset.png, image')).toBeOnTheScreen();
    await waitFor(() =>
      expect(screen.getByTestId('thumb-image')).toBeOnTheScreen(),
    );
  });

  it('never asks without a snapshot', () => {
    renderThumbnail({ snapshotId: null });

    expect(screen.getByTestId('thumb-placeholder')).toBeOnTheScreen();
    expect(getLocalImageHandleMock).not.toHaveBeenCalled();
  });
});
