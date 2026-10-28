import React, { useCallback, useMemo, useState } from 'react';
import { Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Appbar, Button, Text, useTheme } from 'react-native-paper';
import type { DeletionResultDto } from '../native/CloudSyncContracts';
import { SafeAreaView } from 'react-native-safe-area-context';

import { mediaKindOf } from '../files/media';
import { useLocalImage } from '../files/useLocalImage';
import type { RootStackParamList } from '../navigation/AppNavigator';
import {
  GALLERY_THUMBNAIL_EDGE_PX,
  clampImageEdge,
} from '../native/CloudSyncContracts';
import SyncScopeVideoView from '../native/specs/SyncScopeVideoViewNativeComponent';
import { DeleteFlow } from '../selection/DeleteFlow';
import { SelectionBar } from '../selection/SelectionBar';
import { useSelection } from '../selection/SelectionProvider';
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

/** The selection being deleted: fixed when Delete is pressed, as in Files. */
interface DeletionTarget {
  snapshotId: string;
  entryIds: string[];
}

/**
 * The full preview of an image or a video (FR-002, research R8), pushed on the
 * root stack above the tabs. Its params come from the tapped row. Images are
 * read with `getLocalImageHandle`; videos play in the native
 * `SyncScopeVideoView`, muted by default, with the platform controller for
 * play/pause and seek, and a mute toggle in the top bar. Nothing is read from
 * the server (R026), and no document URI reaches JavaScript.
 *
 * The preview takes part in the Files selection (research R11): the top bar
 * toggles this file in or out, the selection bar shows at the bottom whenever
 * something is selected, and its Delete opens the existing `DeleteFlow` for
 * the whole selection. When a finished deletion removed the previewed file,
 * the preview closes as the dialog is dismissed.
 */
export function PreviewScreen({
  navigation,
  route,
}: PreviewScreenProps): React.JSX.Element {
  const { snapshotId, entryId, name, mimeType, sizeBytes, status } =
    route.params;
  const theme = useTheme();
  const selection = useSelection();
  const {
    isSelected,
    isSelecting,
    items,
    removeIds,
    snapshotId: selectionSnapshotId,
    toggle,
  } = selection;
  const selected = isSelected(entryId);
  const [deletion, setDeletion] = useState<DeletionTarget | null>(null);
  const [previewDeleted, setPreviewDeleted] = useState(false);
  const kind = mediaKindOf(mimeType);
  const [muted, setMuted] = useState(true);
  const [videoFailed, setVideoFailed] = useState(false);

  const goBack = useCallback(() => navigation.goBack(), [navigation]);
  const toggleMuted = useCallback(() => setMuted(value => !value), []);
  const onPlaybackError = useCallback(() => setVideoFailed(true), []);

  const toggleSelected = useCallback(
    () => toggle({ entryId, kind: 'FILE', mimeType, sizeBytes, status }),
    [toggle, entryId, mimeType, sizeBytes, status],
  );
  const openDelete = useCallback(() => {
    if (selectionSnapshotId != null && items.size > 0) {
      setDeletion({
        snapshotId: selectionSnapshotId,
        entryIds: [...items.keys()],
      });
    }
  }, [selectionSnapshotId, items]);
  const onDeleted = useCallback(
    (result: DeletionResultDto) => {
      removeIds(result.removedEntryIds);
      if (result.removedEntryIds.includes(entryId)) {
        setPreviewDeleted(true);
      }
    },
    [removeIds, entryId],
  );
  const closeDelete = useCallback(() => {
    setDeletion(null);
    if (previewDeleted) {
      navigation.goBack();
    }
  }, [previewDeleted, navigation]);

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
      // The selection bar pads itself by the bottom inset.
      edges={isSelecting ? ['left', 'right'] : ['bottom', 'left', 'right']}
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
        {kind != null ? (
          <Appbar.Action
            accessibilityLabel={
              selected ? 'Unselect this file' : 'Select this file'
            }
            accessibilityState={{ checked: selected }}
            icon={selected ? 'checkbox-marked' : 'checkbox-blank-outline'}
            onPress={toggleSelected}
            testID="preview-select"
          />
        ) : null}
      </Appbar.Header>
      {body}
      {/* While the dialog is open its own Delete is the only one on screen. */}
      <SelectionBar onDelete={deletion == null ? openDelete : undefined} />
      {deletion != null ? (
        <DeleteFlow
          entryIds={deletion.entryIds}
          onDeleted={onDeleted}
          onDismiss={closeDelete}
          snapshotId={deletion.snapshotId}
          visible
        />
      ) : null}
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
