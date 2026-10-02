import React, {useEffect, useMemo, useState} from 'react';
import {StyleSheet} from 'react-native';
import {Button, Dialog, Portal, Text, useTheme} from 'react-native-paper';

import type {HostKeyChallengeDto} from '../native/CloudSyncContracts';
import {spacing} from '../theme/spacing';

export interface HostKeyDialogProps {
  /** The key to answer; the dialog is hidden while null. */
  challenge: HostKeyChallengeDto | null;
  /** The endpoint trusted a different key before (SFTP_HOST_KEY_CHANGED). */
  changed: boolean;
  onTrust: () => void;
  onReject: () => void;
}

/**
 * Asks whether to trust an SFTP server key (research R2, FR-004). An unknown
 * key is trusted with one tap. A changed key leads with a warning, and its
 * `Trust new key` button needs a second tap before [onTrust] runs. The dialog
 * cannot be dismissed without an answer.
 */
export function HostKeyDialog({
  challenge,
  changed,
  onTrust,
  onReject,
}: HostKeyDialogProps): React.JSX.Element {
  const theme = useTheme();
  const errorColor = theme.colors.error;
  const themed = useMemo(
    () => StyleSheet.create({warning: {color: errorColor}}),
    [errorColor],
  );
  const [confirming, setConfirming] = useState(false);

  // A new challenge always starts unconfirmed.
  const challengeId = challenge?.challengeId ?? null;
  useEffect(() => {
    setConfirming(false);
  }, [challengeId]);

  const trust = () => {
    if (changed && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onTrust();
  };

  return (
    <Portal>
      <Dialog dismissable={false} visible={challenge != null}>
        <Dialog.Title>
          {changed ? 'Server key changed' : 'Trust this server?'}
        </Dialog.Title>
        <Dialog.Content style={styles.content}>
          {changed ? (
            <Text
              accessibilityLabel="Server key changed warning"
              style={themed.warning}
              variant="bodyMedium">
              The server's key is different from the one you trusted before.
              This happens when the server is reinstalled, but it can also mean
              someone is intercepting the connection. Trust the new key only if
              you know why it changed.
            </Text>
          ) : (
            <Text variant="bodyMedium">
              This is the first connection to this server. Check that the
              fingerprint matches the one your server shows.
            </Text>
          )}
          {challenge != null ? (
            <>
              <Text variant="bodySmall">Key type {challenge.algorithm}</Text>
              <Text
                accessibilityLabel={`Server key fingerprint ${challenge.fingerprint}`}
                selectable
                variant="bodyMedium">
                {challenge.fingerprint}
              </Text>
            </>
          ) : null}
          {confirming ? (
            <Text variant="bodyMedium">Tap again to trust the new key</Text>
          ) : null}
        </Dialog.Content>
        <Dialog.Actions>
          <Button accessibilityLabel="Reject server key" onPress={onReject}>
            Reject
          </Button>
          <Button
            accessibilityLabel={changed ? 'Trust new key' : 'Trust server key'}
            onPress={trust}>
            {changed ? 'Trust new key' : 'Trust'}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.sm,
  },
});
