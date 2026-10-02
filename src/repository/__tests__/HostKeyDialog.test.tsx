import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react-native';
import {PaperProvider} from 'react-native-paper';

import type {HostKeyChallengeDto} from '../../native/CloudSyncContracts';
import {a11ySweep} from '../../test-utils/a11ySweep';
import {HostKeyDialog, type HostKeyDialogProps} from '../HostKeyDialog';

const CHALLENGE: HostKeyChallengeDto = {
  challengeId: 'c-1',
  host: 'nas.local',
  port: 22,
  algorithm: 'ssh-ed25519',
  fingerprint: 'SHA256:U3b54O0CASN6rxo5Jas4AiNSVGgFM2adMsobZH67CIg',
  previousFingerprint: null,
};

function renderDialog(overrides: Partial<HostKeyDialogProps> = {}) {
  const props: HostKeyDialogProps = {
    challenge: CHALLENGE,
    changed: false,
    onTrust: jest.fn(),
    onReject: jest.fn(),
    ...overrides,
  };
  const result = render(
    <PaperProvider>
      <HostKeyDialog {...props} />
    </PaperProvider>,
  );
  return {...result, props};
}

describe('HostKeyDialog', () => {
  it('shows the algorithm and fingerprint of an unknown key, trusted with one tap', () => {
    const {props} = renderDialog();

    expect(screen.getByText('Trust this server?')).toBeOnTheScreen();
    expect(screen.getByText('Key type ssh-ed25519')).toBeOnTheScreen();
    expect(
      screen.getByLabelText(`Server key fingerprint ${CHALLENGE.fingerprint}`),
    ).toBeOnTheScreen();
    expect(screen.queryByLabelText('Server key changed warning')).toBeNull();

    fireEvent.press(screen.getByLabelText('Trust server key'));

    expect(props.onTrust).toHaveBeenCalledTimes(1);
  });

  it('rejects with Reject server key', () => {
    const {props} = renderDialog();

    fireEvent.press(screen.getByLabelText('Reject server key'));

    expect(props.onReject).toHaveBeenCalledTimes(1);
    expect(props.onTrust).not.toHaveBeenCalled();
  });

  it('leads a changed key with a warning and labels the button Trust new key', () => {
    renderDialog({
      changed: true,
      challenge: {...CHALLENGE, previousFingerprint: 'SHA256:old'},
    });

    expect(screen.getByLabelText('Server key changed warning')).toBeOnTheScreen();
    expect(screen.getByLabelText('Trust new key')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Trust server key')).toBeNull();
    expect(
      screen.getByLabelText(`Server key fingerprint ${CHALLENGE.fingerprint}`),
    ).toBeOnTheScreen();
  });

  it('needs a second tap to trust a changed key', () => {
    const {props} = renderDialog({changed: true});

    expect(screen.queryByText('Tap again to trust the new key')).toBeNull();
    fireEvent.press(screen.getByLabelText('Trust new key'));

    expect(props.onTrust).not.toHaveBeenCalled();
    expect(screen.getByText('Tap again to trust the new key')).toBeOnTheScreen();

    fireEvent.press(screen.getByLabelText('Trust new key'));

    expect(props.onTrust).toHaveBeenCalledTimes(1);
  });

  it('starts unconfirmed again for a new challenge', () => {
    const {props, rerender} = renderDialog({changed: true});
    fireEvent.press(screen.getByLabelText('Trust new key'));

    rerender(
      <PaperProvider>
        <HostKeyDialog
          {...props}
          challenge={{...CHALLENGE, challengeId: 'c-2'}}
        />
      </PaperProvider>,
    );
    fireEvent.press(screen.getByLabelText('Trust new key'));

    expect(props.onTrust).not.toHaveBeenCalled();
  });

  it('is hidden without a challenge', () => {
    renderDialog({challenge: null});

    expect(screen.queryByLabelText('Trust server key')).toBeNull();
  });

  it('labels every control', () => {
    const unknown = renderDialog();
    a11ySweep(unknown);
    unknown.unmount();
    a11ySweep(renderDialog({changed: true}));
  });
});
