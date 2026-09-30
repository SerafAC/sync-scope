import {createContext, useContext} from 'react';

import {
  STALE_REMOTE_LISTING_MILLIS,
  type ActiveSnapshotDto,
  type CloudSyncError,
  type ScanRunDto,
} from '../native/CloudSyncContracts';

/** How often `getScanState` is polled while a run is not terminal (research R9). */
export const POLL_INTERVAL_MILLIS = 500;

/** Scan state and actions shared app-wide by {@link ScanProvider}. */
export interface ScanState {
  /** The running run, else the most recent one, else null. */
  run: ScanRunDto | null;
  /** The published snapshot the app reads, or null before any completed scan. */
  active: ActiveSnapshotDto | null;
  /**
   * The latest run seen ending CANCELLED or FAILED since the user last started
   * a scan. It stays readable after an automatic local refresh replaces it as
   * the latest run, so "Cancelled (app left)" is not lost on reopen.
   */
  interrupted: ScanRunDto | null;
  /** True until the first `getScanState` has answered. */
  loading: boolean;
  /** The last action or read error, until dismissed or a later scan starts. */
  error: CloudSyncError | null;
  /** A run exists and is not terminal. */
  isRunning: boolean;
  /** The remote listing is older than STALE_REMOTE_LISTING_MILLIS: suggest, never force, a rescan. */
  isStale: boolean;
  /** Starts a FULL scan ("Scan" / "Rescan from scratch"). */
  scan: () => Promise<void>;
  /** Cancels the running run, if any. */
  cancel: () => Promise<void>;
  /** Re-reads the scan state once. */
  refresh: () => Promise<void>;
  dismissError: () => void;
}

export const ScanContext = createContext<ScanState | null>(null);

/** Reads the app-wide scan state; must be rendered inside `ScanProvider`. */
export function useScan(): ScanState {
  const value = useContext(ScanContext);
  if (value == null) {
    throw new Error('useScan must be used inside a ScanProvider');
  }
  return value;
}

export function isRunActive(run: ScanRunDto | null): boolean {
  return run != null && run.terminalState === null;
}

/** Whether a rescan should be suggested for [active] at [now]. */
export function isRemoteListingStale(
  active: ActiveSnapshotDto | null,
  now: number,
): boolean {
  return (
    active != null &&
    now - active.remoteListedAtMillis > STALE_REMOTE_LISTING_MILLIS
  );
}

export function isInterruption(run: ScanRunDto | null): boolean {
  return (
    run != null &&
    (run.terminalState === 'CANCELLED' || run.terminalState === 'FAILED')
  );
}
