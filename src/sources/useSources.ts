import {useCallback, useEffect, useRef, useState} from 'react';
import {AppState} from 'react-native';

import {
  launchSourcePicker,
  listSources,
  removeSource,
} from '../native/CloudSync';
import {
  CloudSyncErrorCode,
  type CloudSyncError,
  type SourceDto,
} from '../native/CloudSyncContracts';

/** A typed error envelope, shaped for the Folders snackbar. */
export interface SourcesError {
  code: string;
  message: string;
  action: string | null;
  conflictingSource: {sourceId: string; alias: string} | null;
}

export interface UseSourcesResult {
  sources: SourceDto[];
  loading: boolean;
  error: SourcesError | null;
  refresh: () => Promise<void>;
  add: () => Promise<void>;
  regrant: (sourceId: string) => Promise<void>;
  remove: (sourceId: string) => Promise<void>;
  dismissError: () => void;
}

/** Shown when a wrapper throws instead of resolving an envelope. */
const UNAVAILABLE_ERROR: SourcesError = {
  code: CloudSyncErrorCode.NATIVE_MODULE_UNAVAILABLE,
  message: 'The folder service is not available.',
  action: 'Restart the app.',
  conflictingSource: null,
};

function toSourcesError(error: CloudSyncError): SourcesError {
  return {
    code: error.code,
    message: error.message,
    action: error.action ?? null,
    conflictingSource: error.conflictingSource ?? null,
  };
}

/**
 * Loads the added folders and owns the three source actions. The list is
 * reloaded whenever the app returns to the foreground, because a grant can
 * be lost while the app is in the background (research R5).
 */
export function useSources(): UseSourcesResult {
  const [sources, setSources] = useState<SourceDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<SourcesError | null>(null);
  const mounted = useRef(true);

  const showError = useCallback((next: SourcesError) => {
    if (mounted.current) {
      setError(next);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const result = await listSources();
      if (!mounted.current) {
        return;
      }
      if (result.status === 'ok') {
        setSources(result.sources);
      } else {
        showError(toSourcesError(result.error));
      }
    } catch {
      showError(UNAVAILABLE_ERROR);
    }
    if (mounted.current) {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    mounted.current = true;
    refresh();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        refresh();
      }
    });
    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, [refresh]);

  const pick = useCallback(
    async (regrantSourceId?: string) => {
      try {
        const result =
          regrantSourceId === undefined
            ? await launchSourcePicker()
            : await launchSourcePicker(regrantSourceId);
        if (result.status === 'error') {
          showError(toSourcesError(result.error));
          return;
        }
        if (result.outcome === 'CANCELLED') {
          return;
        }
      } catch {
        showError(UNAVAILABLE_ERROR);
        return;
      }
      await refresh();
    },
    [refresh, showError],
  );

  const add = useCallback(() => pick(), [pick]);

  const regrant = useCallback((sourceId: string) => pick(sourceId), [pick]);

  const remove = useCallback(
    async (sourceId: string) => {
      try {
        const result = await removeSource(sourceId);
        if (result.status === 'error') {
          showError(toSourcesError(result.error));
          return;
        }
      } catch {
        showError(UNAVAILABLE_ERROR);
        return;
      }
      await refresh();
    },
    [refresh, showError],
  );

  const dismissError = useCallback(() => setError(null), []);

  return {
    sources,
    loading,
    error,
    refresh,
    add,
    regrant,
    remove,
    dismissError,
  };
}
