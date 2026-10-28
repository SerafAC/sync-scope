import React, { useCallback, useMemo, useState } from 'react';
import { Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Appbar, Button, Text, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { mediaKindOf } from '../files/media';
import { useLocalImage } from '../files/useLocalImage';
import type { RootStackParamList } from '../navigation/AppNavigator';
import {
  GALLERY_THUMBNAIL_EDGE_PX,
  clampImageEdge,
} from '../native/CloudSyncContracts';
import SyncScopeVideoView from '../native/specs/SyncScopeVideoViewNativeComponent';
import { spacing } from '../theme/spacing';

export const FILE_GONE_TEXT = 'This file is no longer on the device';
export const VIDEO_UNPLAYABLE_TEXT = "This video can't be played";
export const NOT_PREVIEWABLE_TEXT = "This file can't be previewed";

export type PreviewScreenProps = NativeStackScreenProps<
  RootStackParamList,
  'Preview'
>;

/** A centred message with a Back button: the preview's error states. */
function PreviewMessage({
  text,
  onBack,
}: {
  text: string;
  onBack: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.message} testID="preview-message">
      <Text style={styles.messageText} variant="bodyLarge">
        {text}
      </Text>
      <Button accessibilityLabel="Go back" mode="contained" onPress={onBack}>
        Back
      </Button>
    </View>
  );
}

/**
 * An image at the window's long edge in physical pixels, clamped by the
 * 2048 px cap (research R8). The 256 px gallery thumbnail, already cached,
 * shows while the full image loads. Both read local storage only, through
 * `getLocalImageHandle`.
 */
function ImagePreview({
  snapshotId,
  entryId,
  name,
  onBack,
}: {
  snapshotId: string;
  entryId: string;
  name: string;
  onBack: () => void;
}): React.JSX.Element {
  const { width, height, scale } = useWindowDimensions();
  const edge = clampImageEdge(Math.round(Math.max(width, height) * scale));
  const thumbnail = useLocalImage(
    snapshotId,
    entryId,
    GALLERY_THUMBNAIL_EDGE_PX,
  );
  const full = useLocalImage(snapshotId, entryId, edge);

  if (full.failed) {
    return <PreviewMessage onBack={onBack} text={FILE_GONE_TEXT} />;
  }
  return (
    <View
      accessibilityLabel={name}
      accessibilityRole="image"
      style={styles.media}
      testID="preview-image"
    >
      {full.uri != null ? (
        <Image
          resizeMode="contain"
          source={{ uri: full.uri }}
          style={styles.fill}
          testID="preview-image-full"
        />
      ) : thumbnail.uri != null ? (
        <Image
          resizeMode="contain"
          source={{ uri: thumbnail.uri }}
          style={styles.fill}
          testID="preview-image-thumbnail"
        />
      ) : null}
    </View>
  );
}

/**
 * The full preview of an image or a video (FR-002, research R8), pushed on the
 * root stack above the tabs. Its params come from the tapped row. Images are
 * read with `getLocalImageHandle`; videos play in the native
 * `SyncScopeVideoView`, muted by default, with the platform controller for
 * play/pause and seek, and a mute toggle in the top bar. Nothing is read from
 * the server (R026), and no document URI reaches JavaScript.
 */
export function PreviewScreen({
  navigation,
  route,
}: PreviewScreenProps): React.JSX.Element {
  const { snapshotId, entryId, name, mimeType } = route.params;
  const theme = useTheme();
  const kind = mediaKindOf(mimeType);
  const [muted, setMuted] = useState(true);
  const [videoFailed, setVideoFailed] = useState(false);

  const goBack = useCallback(() => navigation.goBack(), [navigation]);
  const toggleMuted = useCallback(() => setMuted(value => !value), []);
  const onPlaybackError = useCallback(() => setVideoFailed(true), []);

  const themed = useMemo(
    () =>
      StyleSheet.create({
        screen: { backgroundColor: theme.colors.background },
      }),
    [theme.colors.background],
  );

  let body: React.JSX.Element;
  if (kind === 'image') {
    body = (
      <ImagePreview
        entryId={entryId}
        name={name}
        onBack={goBack}
        snapshotId={snapshotId}
      />
    );
  } else if (kind === 'video') {
    body = videoFailed ? (
      <PreviewMessage onBack={goBack} text={VIDEO_UNPLAYABLE_TEXT} />
    ) : (
      <SyncScopeVideoView
        accessibilityLabel={name}
        entryId={entryId}
        muted={muted}
        onPlaybackError={onPlaybackError}
        paused={false}
        snapshotId={snapshotId}
        style={styles.media}
        testID="preview-video"
      />
    );
  } else {
    body = <PreviewMessage onBack={goBack} text={NOT_PREVIEWABLE_TEXT} />;
  }

  return (
    <SafeAreaView
      edges={['bottom', 'left', 'right']}
      style={[styles.screen, themed.screen]}
      testID="preview"
    >
      <Appbar.Header>
        <Appbar.BackAction accessibilityLabel="Back" onPress={goBack} />
        <Appbar.Content title={name} />
        {kind === 'video' && !videoFailed ? (
          <Appbar.Action
            accessibilityLabel={muted ? 'Unmute' : 'Mute'}
            icon={muted ? 'volume-off' : 'volume-high'}
            onPress={toggleMuted}
            testID="preview-mute"
          />
        ) : null}
      </Appbar.Header>
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  media: {
    flex: 1,
  },
  message: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.lg,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  messageText: {
    textAlign: 'center',
  },
  screen: {
    flex: 1,
  },
});
