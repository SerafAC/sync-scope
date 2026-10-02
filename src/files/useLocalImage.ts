import { useEffect, useState } from 'react';

import { getLocalImageHandle } from '../native/CloudSync';
import { GALLERY_THUMBNAIL_EDGE_PX } from '../native/CloudSyncContracts';

export interface LocalImage {
  /** `file://` URI of the cached JPEG; null while loading or after a failure. */
  uri: string | null;
  /** The image could not be read on the device: show the broken-image state. */
  failed: boolean;
}

interface Loaded extends LocalImage {
  key: string;
}

const PENDING: LocalImage = { uri: null, failed: false };

/**
 * A local, downscaled image of [entryId] in [snapshotId] (research R7). It
 * asks `getLocalImageHandle` once per `(snapshotId, entryId, edge)`, and a
 * result that arrives after unmount, or for an earlier key, is ignored.
 */
export function useLocalImage(
  snapshotId: string | null,
  entryId: string,
  edge: number = GALLERY_THUMBNAIL_EDGE_PX,
): LocalImage {
  const key = `${snapshotId}\u0000${entryId}\u0000${edge}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (snapshotId == null) {
      return;
    }
    let live = true;
    getLocalImageHandle(snapshotId, entryId, { maxEdgePx: edge }).then(
      result => {
        if (live) {
          setLoaded(
            result.status === 'ok'
              ? { key, uri: result.handle.uri, failed: false }
              : { key, uri: null, failed: true },
          );
        }
      },
      () => {
        if (live) {
          setLoaded({ key, uri: null, failed: true });
        }
      },
    );
    return () => {
      live = false;
    };
  }, [key, snapshotId, entryId, edge]);

  if (loaded == null || loaded.key !== key) {
    return PENDING;
  }
  return { uri: loaded.uri, failed: loaded.failed };
}
