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
} from '../native/CloudSyncContracts';

/**
 * The repository form's state machine (data-model.md, research R2):
 * `idle → saving → testing → connected | failed | hostKeyPrompt`, and from
 * `hostKeyPrompt` either back to `testing` (trust) or to `rejected`.
 */
export type RepositoryFormState =
  | {kind: 'idle'}
  | {kind: 'saving'}
  | {kind: 'testing'}
  | {kind: 'connected'; entryCount: number}
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
      update({kind: 'connected', entryCount: result.connection.entryCount});
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
