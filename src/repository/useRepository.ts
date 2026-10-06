import {useCallback, useEffect, useRef, useState} from 'react';

import {
  approveSftpHostKey,
  rejectSftpHostKey,
  saveRepository,
  testRepository,
} from '../native/CloudSync';
import {
  CloudSyncErrorCode,
  type CloudSyncError,
  type HostKeyChallengeDto,
  type RepositoryConfigInput,
  type RepositoryField,
  type RepositoryFolderResultDto,
  type RepositoryProtocol,
  type RepositorySummaryDto,
} from '../native/CloudSyncContracts';

/** The form's non-secret fields. The password is kept apart, in its own state. */
export interface RepositoryDraft {
  protocol: RepositoryProtocol;
  host: string;
  /** As typed; empty means the protocol's default port. */
  port: string;
  username: string;
  /**
   * One field per remote folder, as typed, in order (contract version 6).
   * Never empty: a new form has one empty field.
   */
  remoteRoots: string[];
  webdavHttps: boolean;
}

/** A new configuration: one empty folder field, and HTTPS on by default for WebDAV (research R4). */
export const NEW_REPOSITORY_DRAFT: RepositoryDraft = {
  protocol: 'SFTP',
  host: '',
  port: '',
  username: '',
  remoteRoots: [''],
  webdavHttps: true,
};

/** The form as the saved repository fills it. */
export function draftOf(summary: RepositorySummaryDto): RepositoryDraft {
  return {
    protocol: summary.protocol,
    host: summary.host,
    port: String(summary.port),
    username: summary.username,
    remoteRoots:
      summary.remoteRoots.length > 0 ? [...summary.remoteRoots] : [''],
    webdavHttps: summary.webdavHttps,
  };
}

/** [draft] with one more, empty, folder field at the end. */
export function withRemoteRootAdded(draft: RepositoryDraft): RepositoryDraft {
  return {...draft, remoteRoots: [...draft.remoteRoots, '']};
}

/** [draft] without the folder field at [index]; the last field left is never removed. */
export function withRemoteRootRemoved(
  draft: RepositoryDraft,
  index: number,
): RepositoryDraft {
  if (draft.remoteRoots.length <= 1) {
    return draft;
  }
  return {
    ...draft,
    remoteRoots: draft.remoteRoots.filter((_, i) => i !== index),
  };
}

/** [draft] with the folder field at [index] set to [value]. */
export function withRemoteRoot(
  draft: RepositoryDraft,
  index: number,
  value: string,
): RepositoryDraft {
  return {
    ...draft,
    remoteRoots: draft.remoteRoots.map((root, i) => (i === index ? value : root)),
  };
}

/**
 * The repository form's state machine (data-model.md, research R2):
 * `idle → saving → testing → connected | failed | hostKeyPrompt`, and from
 * `hostKeyPrompt` either back to `testing` (trust) or to `rejected`.
 */
export type RepositoryFormState =
  | {kind: 'idle'}
  | {kind: 'saving'}
  | {kind: 'testing'}
  | {
      kind: 'connected';
      /** Entries over every folder that could be listed. */
      entryCount: number;
      /** One line per saved folder, in order: its entry count or its error (research R12). */
      folders: RepositoryFolderResultDto[];
    }
  | {kind: 'failed'; error: CloudSyncError}
  | {kind: 'hostKeyPrompt'; challenge: HostKeyChallengeDto; changed: boolean}
  | {kind: 'rejected'};

export interface UseRepositoryResult {
  state: RepositoryFormState;
  /** True while saving or testing. */
  busy: boolean;
  /**
   * Saves [config] and then tests the connection. [password] goes straight to
   * the native call and is never kept here; null or empty keeps the stored one
   * for the same server and account. Resolves true when the configuration
   * was saved, whatever the test then found.
   */
  saveAndTest: (
    config: RepositoryConfigInput,
    password: string | null,
  ) => Promise<boolean>;
  /** Trusts the prompted SFTP key, then tests again. */
  trust: () => Promise<void>;
  /** Rejects the prompted SFTP key; nothing is trusted. */
  reject: () => Promise<void>;
}

/**
 * The save error to show under [field]; for `remoteRoots`, under the folder at
 * [index]. A folder error without `fieldIndex` is about the whole list and
 * shows under the first folder. Null when the error is about another field.
 */
export function fieldErrorAt(
  state: RepositoryFormState,
  field: RepositoryField,
  index = 0,
): CloudSyncError | null {
  if (state.kind !== 'failed' || state.error.field !== field) {
    return null;
  }
  if (field !== 'remoteRoots') {
    return state.error;
  }
  return (state.error.fieldIndex ?? 0) === index ? state.error : null;
}

/** The connection test's line for the saved folder at [index], once a test passed. */
export function folderResultAt(
  state: RepositoryFormState,
  index: number,
): RepositoryFolderResultDto | null {
  return state.kind === 'connected' ? state.folders[index] ?? null : null;
}

/** Shown when a wrapper throws instead of resolving an envelope. */
const UNAVAILABLE_ERROR: CloudSyncError = {
  code: CloudSyncErrorCode.NATIVE_MODULE_UNAVAILABLE,
  message: 'The repository service is not available.',
  action: 'Restart the app.',
};

export function useRepository(): UseRepositoryResult {
  const [state, setState] = useState<RepositoryFormState>({kind: 'idle'});
  const mounted = useRef(true);
  // The challenge being answered, read by trust/reject without a stale closure.
  const prompt = useRef<HostKeyChallengeDto | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const update = useCallback((next: RepositoryFormState) => {
    prompt.current = next.kind === 'hostKeyPrompt' ? next.challenge : null;
    if (mounted.current) {
      setState(next);
    }
  }, []);

  const runTest = useCallback(async () => {
    update({kind: 'testing'});
    const result = await testRepository();
    if (result.status === 'ok') {
      update({
        kind: 'connected',
        entryCount: result.connection.entryCount,
        folders: result.connection.folders,
      });
      return;
    }
    const {error} = result;
    const challenge = error.hostKeyChallenge;
    if (
      challenge != null &&
      (error.code === CloudSyncErrorCode.SFTP_HOST_KEY_UNVERIFIED ||
        error.code === CloudSyncErrorCode.SFTP_HOST_KEY_CHANGED)
    ) {
      update({
        kind: 'hostKeyPrompt',
        challenge,
        changed: error.code === CloudSyncErrorCode.SFTP_HOST_KEY_CHANGED,
      });
      return;
    }
    update({kind: 'failed', error});
  }, [update]);

  const guarded = useCallback(
    async (work: () => Promise<void>) => {
      try {
        await work();
      } catch {
        update({kind: 'failed', error: UNAVAILABLE_ERROR});
      }
    },
    [update],
  );

  const saveAndTest = useCallback(
    async (config: RepositoryConfigInput, password: string | null) => {
      let stored = false;
      await guarded(async () => {
        update({kind: 'saving'});
        const saved = await saveRepository(config, password);
        if (saved.status !== 'ok') {
          update({kind: 'failed', error: saved.error});
          return;
        }
        stored = true;
        await runTest();
      });
      return stored;
    },
    [guarded, runTest, update],
  );

  const trust = useCallback(
    () =>
      guarded(async () => {
        const challenge = prompt.current;
        if (challenge == null) {
          return;
        }
        update({kind: 'testing'});
        const approved = await approveSftpHostKey(challenge.challengeId);
        if (approved.status !== 'ok') {
          update({kind: 'failed', error: approved.error});
          return;
        }
        await runTest();
      }),
    [guarded, runTest, update],
  );

  const reject = useCallback(
    () =>
      guarded(async () => {
        const challenge = prompt.current;
        if (challenge == null) {
          return;
        }
        const rejected = await rejectSftpHostKey(challenge.challengeId);
        update(
          rejected.status === 'ok'
            ? {kind: 'rejected'}
            : {kind: 'failed', error: rejected.error},
        );
      }),
    [guarded, update],
  );

  return {
    state,
    busy: state.kind === 'saving' || state.kind === 'testing',
    saveAndTest,
    trust,
    reject,
  };
}
