import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import {
  executeLocalDeletion,
  prepareLocalDeletion,
} from '../../native/CloudSync';
import {
  CLOUD_SYNC_CONTRACT_VERSION,
  STALE_REMOTE_LISTING_MILLIS,
  type DeletionPlanDto,
  type DeletionResultDto,
  type ExecuteLocalDeletionResult,
  type OperationError,
  type PrepareLocalDeletionResult,
} from '../../native/CloudSyncContracts';
import { a11ySweep } from '../../test-utils/a11ySweep';
import {
  DELETION_REASON_TEXT,
  DeleteFlow,
  type DeleteFlowProps,
} from '../DeleteFlow';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

jest.mock('../../native/CloudSync', () => ({
  prepareLocalDeletion: jest.fn(),
  executeLocalDeletion: jest.fn(),
}));

const prepareMock = prepareLocalDeletion as jest.MockedFunction<
  typeof prepareLocalDeletion
>;
const executeMock = executeLocalDeletion as jest.MockedFunction<
  typeof executeLocalDeletion
>;

const NOW = 1_800_000_000_000;
const v = CLOUD_SYNC_CONTRACT_VERSION;

function plan(overrides: Partial<DeletionPlanDto> = {}): DeletionPlanDto {
  return {
    planToken: 'tok-1',
    toDelete: { count: 3, bytes: 300 },
    unsynced: { count: 0, bytes: 0 },
    refused: { count: 0, scanTooOld: 0 },
    movedByRecheck: 0,
    missing: 0,
    unknownSizeCount: 0,
    remoteListedAtMillis: NOW - 5 * 60_000,
    ...overrides,
  };
}

function planned(p: DeletionPlanDto = plan()): PrepareLocalDeletionResult {
  return { contractVersion: v, status: 'ok', plan: p };
}

function failed(
  code: string,
  message = 'Failed.',
  action: string | null = 'Do this.',
): OperationError {
  return {
    contractVersion: v,
    status: 'error',
    error: { code, message, action, conflictingSource: null },
  };
}

function deleted(
  overrides: Partial<DeletionResultDto> = {},
): ExecuteLocalDeletionResult {
  return {
    contractVersion: v,
    status: 'ok',
    result: {
      deleted: 3,
      freedBytes: 300,
      failures: [],
      removedEntryIds: ['e-1', 'e-2', 'e-3'],
      ...overrides,
    },
  };
}

function renderFlow(overrides: Partial<DeleteFlowProps> = {}) {
  const props: DeleteFlowProps = {
    visible: true,
    snapshotId: 'snap-1',
    entryIds: ['e-1', 'e-2', 'e-3'],
    onDismiss: jest.fn(),
    onDeleted: jest.fn(),
    now: () => NOW,
    ...overrides,
  };
  const result = render(
    <PaperProvider>
      <DeleteFlow {...props} />
    </PaperProvider>,
  );
  return { ...result, props };
}

beforeEach(() => {
  prepareMock.mockReset();
  executeMock.mockReset();
  mockNavigate.mockReset();
});

describe('DeleteFlow checking', () => {
  it('shows the check with a progress indicator while prepare runs', async () => {
    let resolve: (r: PrepareLocalDeletionResult) => void = () => {};
    prepareMock.mockReturnValue(
      new Promise(done => {
        resolve = done;
      }),
    );

    renderFlow();

    expect(
      screen.getByLabelText('Checking files on the server'),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('Checking')).toBeOnTheScreen();
    expect(prepareMock).toHaveBeenCalledWith('snap-1', ['e-1', 'e-2', 'e-3']);
    expect(screen.queryByLabelText('Delete')).toBeNull();

    await act(async () => resolve(planned()));
    expect(
      screen.getByLabelText('Delete 3 backed-up files, 300 B'),
    ).toBeOnTheScreen();
  });

  it('does nothing while hidden', () => {
    renderFlow({ visible: false });
    expect(prepareMock).not.toHaveBeenCalled();
  });
});

describe('DeleteFlow prepare errors', () => {
  it('shows the message, the action and Retry, and no confirmation', async () => {
    prepareMock.mockResolvedValueOnce(
      failed(
        'CONNECTION_REFUSED',
        'The server refused the connection.',
        'Check the server.',
      ),
    );
    prepareMock.mockResolvedValueOnce(planned());

    renderFlow();

    expect(
      await screen.findByText('The server refused the connection.'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Check the server.')).toBeOnTheScreen();
    expect(screen.queryByLabelText(/backed-up files/)).toBeNull();
    expect(screen.queryByLabelText('Delete')).toBeNull();
    expect(screen.queryByLabelText('Go there')).toBeNull();

    fireEvent.press(screen.getByLabelText('Retry'));

    expect(
      await screen.findByLabelText('Delete 3 backed-up files, 300 B'),
    ).toBeOnTheScreen();
    expect(prepareMock).toHaveBeenCalledTimes(2);
  });

  it('offers Go there when the code has a target', async () => {
    prepareMock.mockResolvedValue(
      failed(
        'SFTP_HOST_KEY_CHANGED',
        'The key changed.',
        'Check the server in Settings › Repository.',
      ),
    );
    const { props } = renderFlow();

    fireEvent.press(await screen.findByLabelText('Go there'));

    expect(mockNavigate).toHaveBeenCalledWith('Repository');
    expect(props.onDismiss).toHaveBeenCalled();
  });

  it('Cancel dismisses', async () => {
    prepareMock.mockResolvedValue(
      failed('REPOSITORY_CHANGED', 'Old settings.'),
    );
    const { props } = renderFlow();
    await screen.findByText('Old settings.');

    fireEvent.press(screen.getByLabelText('Cancel'));

    expect(props.onDismiss).toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });
});

describe('DeleteFlow confirmation', () => {
  it('shows only the backed-up line, the scan age and the permanence note for a plain plan', async () => {
    prepareMock.mockResolvedValue(planned());
    renderFlow();

    expect(
      await screen.findByLabelText('Delete 3 backed-up files, 300 B'),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('Scan age 5 minutes ago')).toBeOnTheScreen();
    expect(
      screen.getByText('Deleted files cannot be recovered.'),
    ).toBeOnTheScreen();
    expect(screen.queryByLabelText(/^Not backed up/)).toBeNull();
    expect(screen.queryByLabelText(/^Never deleted/)).toBeNull();
    expect(screen.queryByLabelText(/^Moved by server check/)).toBeNull();
    expect(screen.queryByLabelText('Rescan suggested')).toBeNull();
    expect(
      screen.getByLabelText('Delete').props.accessibilityState?.disabled,
    ).toBeFalsy();
  });

  it('shows never-deleted files and the scan-too-old hint', async () => {
    prepareMock.mockResolvedValue(
      planned(plan({ refused: { count: 3, scanTooOld: 2 } })),
    );
    renderFlow();

    expect(await screen.findByLabelText('Never deleted 3')).toBeOnTheScreen();
    expect(
      screen.getByText('Never deleted: 3. Their backup state is unknown.'),
    ).toBeOnTheScreen();
    expect(
      screen.getByText('2 of them: Scan again to delete these.'),
    ).toBeOnTheScreen();
  });

  it('omits the scan-too-old hint when it is zero', async () => {
    prepareMock.mockResolvedValue(
      planned(plan({ refused: { count: 1, scanTooOld: 0 } })),
    );
    renderFlow();

    await screen.findByLabelText('Never deleted 1');
    expect(screen.queryByText(/Scan again to delete these/)).toBeNull();
  });

  it('shows how many files the server check moved', async () => {
    prepareMock.mockResolvedValue(planned(plan({ movedByRecheck: 1 })));
    renderFlow();

    expect(
      await screen.findByLabelText('Moved by server check 1'),
    ).toBeOnTheScreen();
  });

  it('suggests a rescan for a listing older than the staleness threshold', async () => {
    prepareMock.mockResolvedValue(
      planned(
        plan({ remoteListedAtMillis: NOW - STALE_REMOTE_LISTING_MILLIS - 1 }),
      ),
    );
    renderFlow();

    expect(await screen.findByLabelText('Rescan suggested')).toBeOnTheScreen();
    expect(screen.getByLabelText('Scan age 7 days ago')).toBeOnTheScreen();
  });

  it('shows unknown sizes and missing files', async () => {
    prepareMock.mockResolvedValue(
      planned(plan({ unknownSizeCount: 2, missing: 1 })),
    );
    renderFlow();

    expect(
      await screen.findByText('2 of unknown size, not counted in the total'),
    ).toBeOnTheScreen();
    expect(screen.getByText('1 no longer in the results')).toBeOnTheScreen();
  });

  it('disables Delete when nothing would be deleted', async () => {
    prepareMock.mockResolvedValue(
      planned(
        plan({
          toDelete: { count: 0, bytes: 0 },
          refused: { count: 2, scanTooOld: 0 },
        }),
      ),
    );
    renderFlow();

    await screen.findByLabelText('Delete 0 backed-up files, 0 B');
    expect(
      screen.getByLabelText('Delete').props.accessibilityState?.disabled,
    ).toBe(true);
    fireEvent.press(screen.getByLabelText('Delete'));
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('Cancel dismisses without deleting', async () => {
    prepareMock.mockResolvedValue(planned());
    const { props } = renderFlow();
    await screen.findByLabelText('Delete 3 backed-up files, 300 B');

    fireEvent.press(screen.getByLabelText('Cancel'));

    expect(props.onDismiss).toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('names every control', async () => {
    prepareMock.mockResolvedValue(
      planned(
        plan({
          unsynced: { count: 1, bytes: 10 },
          refused: { count: 1, scanTooOld: 1 },
          movedByRecheck: 1,
        }),
      ),
    );
    const result = renderFlow();
    await screen.findByLabelText('Also delete files that are not backed up');
    fireEvent.press(
      screen.getByLabelText('Also delete files that are not backed up'),
    );

    expect(() => a11ySweep(result)).not.toThrow();
  });
});

describe('DeleteFlow not backed up opt-in', () => {
  const withUnsynced = plan({
    toDelete: { count: 0, bytes: 0 },
    unsynced: { count: 1, bytes: 40 },
  });

  it('excludes not-backed-up files by default', async () => {
    prepareMock.mockResolvedValue(
      planned(plan({ unsynced: { count: 2, bytes: 40 } })),
    );
    executeMock.mockResolvedValue(deleted());
    renderFlow();

    expect(await screen.findByLabelText('Not backed up 2')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Confirm not backed up')).toBeNull();
    fireEvent.press(screen.getByLabelText('Delete'));

    await waitFor(() =>
      expect(executeMock).toHaveBeenCalledWith('tok-1', false),
    );
  });

  it('needs the checkbox and the second confirmation before includeUnsynced is true', async () => {
    prepareMock.mockResolvedValue(planned(withUnsynced));
    executeMock.mockResolvedValue(deleted({ deleted: 1, freedBytes: 40 }));
    renderFlow();

    await screen.findByLabelText('Not backed up 1');
    const deleteButton = () => screen.getByLabelText('Delete');
    expect(deleteButton().props.accessibilityState?.disabled).toBe(true);

    fireEvent.press(
      screen.getByLabelText('Also delete files that are not backed up'),
    );
    expect(
      screen.getByText(
        'These files exist only on this phone. Deleting them cannot be undone.',
      ),
    ).toBeOnTheScreen();
    // Ticked but not confirmed: still nothing to delete.
    expect(deleteButton().props.accessibilityState?.disabled).toBe(true);

    fireEvent.press(screen.getByLabelText('Confirm not backed up'));
    expect(deleteButton().props.accessibilityState?.disabled).toBeFalsy();

    fireEvent.press(deleteButton());

    await waitFor(() =>
      expect(executeMock).toHaveBeenCalledWith('tok-1', true),
    );
  });

  it('unticking the checkbox drops the confirmation', async () => {
    prepareMock.mockResolvedValue(
      planned(plan({ unsynced: { count: 1, bytes: 40 } })),
    );
    executeMock.mockResolvedValue(deleted());
    renderFlow();

    const checkbox = await screen.findByLabelText(
      'Also delete files that are not backed up',
    );
    fireEvent.press(checkbox);
    fireEvent.press(screen.getByLabelText('Confirm not backed up'));
    fireEvent.press(
      screen.getByLabelText('Also delete files that are not backed up'),
    );
    fireEvent.press(
      screen.getByLabelText('Also delete files that are not backed up'),
    );
    // Ticked again, but the second confirmation must be given again.
    expect(screen.getByLabelText('Confirm not backed up')).toBeOnTheScreen();
    fireEvent.press(screen.getByLabelText('Delete'));

    await waitFor(() =>
      expect(executeMock).toHaveBeenCalledWith('tok-1', false),
    );
  });
});

describe('DeleteFlow deleting and result', () => {
  it('shows progress, then the totals and one line per failure', async () => {
    prepareMock.mockResolvedValue(planned());
    let resolve: (r: ExecuteLocalDeletionResult) => void = () => {};
    executeMock.mockReturnValue(
      new Promise(done => {
        resolve = done;
      }),
    );
    const { props } = renderFlow();

    fireEvent.press(await screen.findByLabelText('Delete'));
    expect(screen.getByText('Deleting 3 files…')).toBeOnTheScreen();
    expect(props.onDeleted).not.toHaveBeenCalled();

    const result = deleted({
      deleted: 1,
      freedBytes: 100,
      failures: [
        { entryId: 'e-2', name: 'beach.png', reason: 'ALREADY_GONE' },
        { entryId: 'e-3', name: 'sunset.png', reason: 'CHANGED' },
      ],
      removedEntryIds: ['e-1', 'e-2'],
    });
    await act(async () => resolve(result));

    expect(
      screen.getByLabelText('Deleted 1 files, freed 100 B'),
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Could not delete beach.png: Already gone'),
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText(
        'Could not delete sunset.png: Changed since the scan',
      ),
    ).toBeOnTheScreen();
    expect(props.onDeleted).toHaveBeenCalledTimes(1);
    expect(props.onDeleted).toHaveBeenCalledWith(
      result.status === 'ok' ? result.result : null,
    );

    fireEvent.press(screen.getByLabelText('Done'));
    expect(props.onDismiss).toHaveBeenCalled();
  });

  it('has a text for every failure reason', () => {
    expect(DELETION_REASON_TEXT).toEqual({
      ALREADY_GONE: 'Already gone',
      CHANGED: 'Changed since the scan',
      ACCESS_LOST: 'No permission to delete in this folder',
      FAILED: 'Could not be deleted',
    });
  });

  it.each(['PLAN_STALE', 'PLAN_NOT_FOUND'])(
    '%s returns to the check after Review again',
    async code => {
      prepareMock
        .mockResolvedValueOnce(planned())
        .mockResolvedValueOnce(planned(plan({ planToken: 'tok-2' })));
      executeMock
        .mockResolvedValueOnce(
          failed(
            code,
            'The results changed.',
            'Review the selection and tap Delete again.',
          ),
        )
        .mockResolvedValueOnce(deleted());
      const { props } = renderFlow();

      fireEvent.press(await screen.findByLabelText('Delete'));
      expect(await screen.findByText('The results changed.')).toBeOnTheScreen();
      expect(screen.queryByLabelText('Retry')).toBeNull();
      expect(props.onDeleted).not.toHaveBeenCalled();

      fireEvent.press(screen.getByLabelText('Review again'));

      fireEvent.press(await screen.findByLabelText('Delete'));
      await waitFor(() =>
        expect(executeMock).toHaveBeenLastCalledWith('tok-2', false),
      );
      expect(prepareMock).toHaveBeenCalledTimes(2);
    },
  );

  it('another execute error offers Retry, which checks again', async () => {
    prepareMock.mockResolvedValue(planned());
    executeMock.mockResolvedValue(
      failed('SCAN_IN_PROGRESS', 'A scan is already running.'),
    );
    renderFlow();

    fireEvent.press(await screen.findByLabelText('Delete'));
    expect(
      await screen.findByText('A scan is already running.'),
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByLabelText('Retry'));

    await waitFor(() => expect(prepareMock).toHaveBeenCalledTimes(2));
  });

  it('a reply that arrives after the dialog closed is dropped', async () => {
    let resolve: (r: PrepareLocalDeletionResult) => void = () => {};
    prepareMock.mockReturnValue(
      new Promise(done => {
        resolve = done;
      }),
    );
    const { rerender, props } = renderFlow();

    rerender(
      <PaperProvider>
        <DeleteFlow {...props} visible={false} />
      </PaperProvider>,
    );
    await act(async () => resolve(planned()));

    expect(screen.queryByLabelText(/backed-up files/)).toBeNull();
  });
});
