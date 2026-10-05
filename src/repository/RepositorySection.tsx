import React, {useCallback, useEffect, useRef, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {ActivityIndicator, Button, Surface, Text} from 'react-native-paper';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {getRepositorySummary} from '../native/CloudSync';
import type {
  RepositoryProtocol,
  RepositorySummaryDto,
} from '../native/CloudSyncContracts';
import type {RootStackParamList} from '../navigation/AppNavigator';
import {spacing} from '../theme/spacing';

/** The protocol as the form's segmented buttons name it. */
export const PROTOCOL_LABEL: Record<RepositoryProtocol, string> = {
  FTP: 'FTP',
  SFTP: 'SFTP',
  WEBDAV: 'WebDAV',
};

/** The summary line, also its accessibility label (contracts/maestro-mvp.md › Selectors). */
export function repositoryTitle(repository: RepositorySummaryDto): string {
  return `Repository ${PROTOCOL_LABEL[repository.protocol]} ${repository.host}`;
}

type SectionState =
  | {kind: 'loading'}
  | {kind: 'notConfigured'}
  | {kind: 'configured'; repository: RepositorySummaryDto}
  | {kind: 'error'; message: string};

/**
 * Settings › Repository: a summary of the saved server, or "not set up", and
 * the one button that opens the Repository form. The summary is read again
 * every time the Settings tab gains focus, so it reflects a save made in the
 * form. The password itself never reaches JS; only its presence is shown.
 */
export function RepositorySection(): React.JSX.Element {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [state, setState] = useState<SectionState>({kind: 'loading'});
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const result = await getRepositorySummary().catch(() => null);
    if (!mounted.current) {
      return;
    }
    if (result?.status === 'ok') {
      setState({kind: 'configured', repository: result.repository});
    } else if (
      result == null ||
      result.error.code === 'REPOSITORY_NOT_CONFIGURED'
    ) {
      setState({kind: 'notConfigured'});
    } else {
      setState({kind: 'error', message: result.error.message});
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const openForm = () => navigation.navigate('Repository');

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" variant="titleLarge">
        Repository
      </Text>
      <Text variant="bodyMedium">
        The server that holds your backup.
      </Text>
      {state.kind === 'loading' ? (
        <ActivityIndicator accessibilityLabel="Loading repository" />
      ) : null}
      {state.kind === 'notConfigured' || state.kind === 'error' ? (
        <Surface elevation={1} style={styles.card}>
          <Text accessibilityLabel="Repository not set up" variant="titleMedium">
            Repository not set up
          </Text>
          {state.kind === 'error' ? (
            <Text variant="bodyMedium">{state.message}</Text>
          ) : null}
          <Button
            accessibilityLabel="Set up repository"
            icon="server-plus"
            mode="contained"
            onPress={openForm}
            style={styles.button}>
            Set up repository
          </Button>
        </Surface>
      ) : null}
      {state.kind === 'configured' ? (
        <Surface elevation={1} style={styles.card}>
          <Text
            accessibilityLabel={repositoryTitle(state.repository)}
            variant="titleMedium">
            {repositoryTitle(state.repository)}
          </Text>
          <Text variant="bodyMedium">{`User ${state.repository.username}`}</Text>
          <Text variant="bodyMedium">
            {`Folder ${state.repository.remoteRoot}`}
          </Text>
          <Text variant="bodyMedium">
            {state.repository.credentialPresent
              ? 'Password stored'
              : 'Password needed'}
          </Text>
          <Button
            accessibilityLabel="Edit repository"
            icon="pencil-outline"
            mode="outlined"
            onPress={openForm}
            style={styles.button}>
            Edit repository
          </Button>
        </Surface>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
  },
  card: {
    borderRadius: 16,
    gap: spacing.xs,
    padding: spacing.lg,
  },
  section: {
    gap: spacing.md,
  },
});
