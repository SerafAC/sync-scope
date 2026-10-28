import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/AppNavigator';
import type { FileEntryDto } from '../native/CloudSyncContracts';
import { isMediaMime } from './media';

/** The fields of a tapped row the preview's params are taken from. */
export type PreviewableEntry = Pick<
  FileEntryDto,
  'entryId' | 'name' | 'mimeType' | 'sizeBytes' | 'status'
>;

/**
 * The tap on a file row or tile when nothing is selected (research R8): a
 * media file opens `Preview` on the root stack with its params taken from the
 * row, so the preview renders at once; any other file does nothing (documents
 * stay out of scope, R029). Shared by the gallery, list and tree views.
 */
export function useOpenPreview(
  snapshotId: string | null,
): (entry: PreviewableEntry) => void {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return useCallback(
    (entry: PreviewableEntry) => {
      const { mimeType } = entry;
      if (snapshotId == null || mimeType == null || !isMediaMime(mimeType)) {
        return;
      }
      navigation.navigate('Preview', {
        snapshotId,
        entryId: entry.entryId,
        name: entry.name,
        mimeType,
        sizeBytes: entry.sizeBytes,
        status: entry.status,
      });
    },
    [navigation, snapshotId],
  );
}
