import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {AppState} from 'react-native';

import {cancelScan, getScanState, startScan} from '../native/CloudSync';
import {
  CloudSyncErrorCode,
  type ActiveSnapshotDto,
  type CloudSyncError,
  type ScanRunDto,
  type ScanStateOk,
} from '../native/CloudSyncContracts';
import {
  POLL_INTERVAL_MILLIS,
  ScanContext,
  isInterruption,
  isRemoteListingStale,
  isRunActive,
  type ScanState,
} from './useScan';

/** Shown when a wrapper throws instead of resolving an envelope. */
const UNAVAILABLE_ERROR: CloudSyncError = {
  code: CloudSyncErrorCode.NATIVE_MODULE_UNAVAILABLE,
  message: 'The scan service is not available.',
  action: 'Restart the app.',
};

/**
 * Errors of the automatic local refresh that the user has nothing to do
 * about: no current remote listing to reuse (research R2), or a run that
 * started in between.
 */
const SILENT_REFRESH_ERRORS: ReadonlySet<string> = new Set([
  CloudSyncErrorCode.REFRESH_UNAVAILABLE,
  CloudSyncErrorCode.SCAN_IN_PROGRESS,
]);

/**
 * App-wide scan state (plan "Structure Decision"): polls `getScanState` every
 * 500 ms while a run is active, and starts a LOCAL_REFRESH on open and on
 * every return to the foreground when a snapshot is active and nothing runs
 * (FR-003), whichever tab is showing.
 */
export function ScanProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [run, setRun] = useState<ScanRunDto | null>(null);
  const [active, setActive] = useState<ActiveSnapshotDto | null>(null);
  const [interrupted, setInterrupted] = useState<ScanRunDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<CloudSyncError | null>(null);
  const mounted = useRef(true);
  const refreshing = useRef(false);

  const readState = useCallback(async (): Promise<ScanStateOk | null> => {
    let result;
    try {
      result = await getScanState();
    } catch {
      result = null;
    }
    if (!mounted.current) {
      return null;
    }
    setLoading(false);
    if (result == null) {
      setError(UNAVAILABLE_ERROR);
      return null;
    }
    if (result.status === 'error') {
      setError(result.error);
      return null;
    }
    setRun(result.run);
    setActive(result.active);
    if (isInterruption(result.run)) {
      setInterrupted(result.run);
    }
    return result;
  }, []);

  const refresh = useCallback(async () => {
    await readState();
  }, [readState]);

  const autoRefresh = useCallback(async () => {
    if (refreshing.current) {
      return;
    }
    refreshing.current = true;
    try {
      const current = await readState();
      if (current == null || current.active == null || isRunActive(current.run)) {
        return;
      }
      let started;
      try {
        started = await startScan('LOCAL_REFRESH');
      } catch {
        started = null;
      }
      if (!mounted.current) {
        return;
      }
      if (started == null) {
        setError(UNAVAILABLE_ERROR);
      } else if (started.status === 'ok') {
        await readState();
      } else if (!SILENT_REFRESH_ERRORS.has(started.error.code)) {
        setError(started.error);
      }
    } finally {
      refreshing.current = false;
    }
  }, [readState]);

  useEffect(() => {
    mounted.current = true;
    autoRefresh();
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') {
        autoRefresh();
      }
    });
    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, [autoRefresh]);

  const polling = isRunActive(run);
  useEffect(() => {
    if (!polling) {
      return undefined;
    }
    const timer = setInterval(() => {
      readState();
    }, POLL_INTERVAL_MILLIS);
    return () => clearInterval(timer);
  }, [polling, readState]);

  const scan = useCallback(async () => {
    let started;
    try {
      started = await startScan('FULL');
    } catch {
      started = null;
    }
    if (!mounted.current) {
      return;
    }
    if (started == null) {
      setError(UNAVAILABLE_ERROR);
      return;
    }
    if (started.status === 'error') {
      setError(started.error);
      return;
    }
    setError(null);
    setInterrupted(null);
    await readState();
  }, [readState]);

  const cancel = useCallback(async () => {
    if (run == null || !isRunActive(run)) {
      return;
    }
    let result;
    try {
      result = await cancelScan(run.runId);
    } catch {
      result = null;
    }
    if (!mounted.current) {
      return;
    }
    if (result == null) {
      setError(UNAVAILABLE_ERROR);
      return;
    }
    if (result.status === 'error') {
      setError(result.error);
    }
    await readState();
  }, [readState, run]);

  const dismissError = useCallback(() => setError(null), []);

  const value = useMemo<ScanState>(
    () => ({
      run,
      active,
      interrupted,
      loading,
      error,
      isRunning: isRunActive(run),
      isStale: isRemoteListingStale(active, Date.now()),
      scan,
      cancel,
      refresh,
      dismissError,
    }),
    [run, active, interrupted, loading, error, scan, cancel, refresh, dismissError],
  );

  return <ScanContext.Provider value={value}>{children}</ScanContext.Provider>;
}
