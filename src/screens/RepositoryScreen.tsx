import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  AppState,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  ActivityIndicator,
  Button,
  Dialog,
  HelperText,
  Portal,
  ProgressBar,
  SegmentedButtons,
  Switch,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';
import {SafeAreaView} from 'react-native-safe-area-context';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';

import {getRepositorySummary} from '../native/CloudSync';
import {
  REPOSITORY_DEFAULT_PORTS,
  type CloudSyncError,
  type RepositoryField,
  type RepositoryProtocol,
  type RepositorySummaryDto,
} from '../native/CloudSyncContracts';
import type {RootStackParamList} from '../navigation/AppNavigator';
import {HostKeyDialog} from '../repository/HostKeyDialog';
import {splitServerAddress} from '../repository/serverAddress';
import {
  useRepository,
  type RepositoryFormState,
} from '../repository/useRepository';
import {useScan} from '../scan/useScan';
import {spacing} from '../theme/spacing';

type Props = NativeStackScreenProps<RootStackParamList, 'Repository'>;

/** The form's non-secret fields. The password is kept apart, in its own state. */
export interface RepositoryDraft {
  protocol: RepositoryProtocol;
  host: string;
  /** As typed; empty means the protocol's default port. */
  port: string;
  username: string;
  remoteRoot: string;
  webdavHttps: boolean;
}

/** A new configuration: HTTPS is on by default for WebDAV (research R4). */
const NEW_DRAFT: RepositoryDraft = {
  protocol: 'SFTP',
  host: '',
  port: '',
  username: '',
  remoteRoot: '',
  webdavHttps: true,
};

const PROTOCOL_BUTTONS = [
  {value: 'FTP', label: 'FTP', accessibilityLabel: 'Protocol FTP'},
  {value: 'SFTP', label: 'SFTP', accessibilityLabel: 'Protocol SFTP'},
  {value: 'WEBDAV', label: 'WebDAV', accessibilityLabel: 'Protocol WebDAV'},
];

export const UNENCRYPTED_WARNING =
  'The password and file names are sent unencrypted. Use only on a network you trust.';
export const PASSWORD_STORED_HINT =
  'A password is stored. Leave empty to keep it.';

function draftOf(summary: RepositorySummaryDto): RepositoryDraft {
  return {
    protocol: summary.protocol,
    host: summary.host,
    port: String(summary.port),
    username: summary.username,
    remoteRoot: summary.remoteRoot,
    webdavHttps: summary.webdavHttps,
  };
}

/** The port the native side uses when the field is empty (mirrored constant, research R2). */
export function defaultPortFor(
  protocol: RepositoryProtocol,
  webdavHttps: boolean,
): number {
  if (protocol === 'WEBDAV' && webdavHttps) {
    return REPOSITORY_DEFAULT_PORTS.WEBDAV_HTTPS;
  }
  return REPOSITORY_DEFAULT_PORTS[protocol];
}

/**
 * The draft with a server URL typed into Host spread over the other fields: protocol, HTTPS, port,
 * user name and remote folder, as far as the URL names them. A URL that switches the protocol but
 * names no port clears the port, so the new protocol's default applies.
 */
export function withServerAddress(draft: RepositoryDraft): RepositoryDraft {
  const parts = splitServerAddress(draft.host);
  if (parts == null) {
    return draft;
  }
  const protocolChanged =
    parts.protocol != null && parts.protocol !== draft.protocol;
  return {
    ...draft,
    ...parts,
    port: parts.port ?? (protocolChanged ? '' : draft.port),
  };
}

function sameDraft(a: RepositoryDraft, b: RepositoryDraft): boolean {
  return (
    a.protocol === b.protocol &&
    a.host === b.host &&
    a.port === b.port &&
    a.username === b.username &&
    a.remoteRoot === b.remoteRoot &&
    (a.protocol !== 'WEBDAV' || a.webdavHttps === b.webdavHttps)
  );
}

/** Empty → null (the default port); anything else is sent as a number for native to validate. */
function portValue(text: string): number | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : Number(trimmed);
}

function statusText(state: RepositoryFormState): string | null {
  switch (state.kind) {
    case 'connected':
      return `Connected, ${state.entryCount} entries`;
    case 'failed':
      return state.error.field != null
        ? null
        : `Connection failed: ${state.error.message}`;
    case 'rejected':
      return 'Server key rejected. The server is not trusted.';
    default:
      return null;
  }
}

/**
 * Settings › Repository: the form that saves, tests and approves the server
 * (research R1, R2). Native `parse` is the only validator; the form only
 * disables saving while a required field is empty or a scan runs. Leaving
 * with unsaved changes asks first, and the password is never prefilled and is
 * cleared after every save and whenever the app goes to the background.
 */
export function RepositoryScreen({navigation}: Props): React.JSX.Element {
  const theme = useTheme();
  const {isRunning} = useScan();
  const {state, busy, saveAndTest, trust, reject} = useRepository();

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<RepositorySummaryDto | null>(null);
  const [draft, setDraft] = useState<RepositoryDraft>(NEW_DRAFT);
  const [password, setPassword] = useState('');
  const [leaveAction, setLeaveAction] = useState<
    Parameters<typeof navigation.dispatch>[0] | null
  >(null);
  const mounted = useRef(true);
  // Set once the user chose to discard, so the re-dispatched action is not stopped again.
  const leaving = useRef(false);

  const baseline = useMemo(
    () => (summary != null ? draftOf(summary) : NEW_DRAFT),
    [summary],
  );
  const dirty = password !== '' || !sameDraft(draft, baseline);

  const loadSummary = useCallback(async (prefill: boolean) => {
    const result = await getRepositorySummary().catch(() => null);
    if (!mounted.current) {
      return;
    }
    const next = result?.status === 'ok' ? result.repository : null;
    setSummary(next);
    if (prefill && next != null) {
      setDraft(draftOf(next));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    loadSummary(true);
    return () => {
      mounted.current = false;
    };
  }, [loadSummary]);

  // The draft survives the background (the screen stays mounted); the password does not.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'background') {
        setPassword('');
      }
    });
    return () => subscription.remove();
  }, []);

  // The stack's beforeRemove catches the header back arrow and the system back button (R1).
  useEffect(
    () =>
      navigation.addListener('beforeRemove', event => {
        if (!dirty || busy || leaving.current) {
          return;
        }
        event.preventDefault();
        setLeaveAction(event.data.action);
      }),
    [navigation, dirty, busy],
  );

  const set = <K extends keyof RepositoryDraft>(
    key: K,
    value: RepositoryDraft[K],
  ) => setDraft(current => ({...current, [key]: value}));

  // What Save sends: a URL in Host already split up, even before the field loses focus.
  const resolved = useMemo(() => withServerAddress(draft), [draft]);

  const credentialStored = summary?.credentialPresent === true;
  const missingRequired =
    resolved.host.trim() === '' ||
    resolved.username.trim() === '' ||
    resolved.remoteRoot.trim() === '' ||
    (!credentialStored && password === '');
  const saveDisabled = loading || busy || isRunning || missingRequired;

  const unencrypted =
    draft.protocol === 'FTP' ||
    (draft.protocol === 'WEBDAV' && !draft.webdavHttps);

  const save = async () => {
    const typed = password;
    setPassword('');
    setDraft(resolved);
    const saved = await saveAndTest(
      {
        protocol: resolved.protocol,
        host: resolved.host.trim(),
        port: portValue(resolved.port),
        username: resolved.username,
        remoteRoot: resolved.remoteRoot.trim(),
        webdavHttps: resolved.protocol === 'WEBDAV' && resolved.webdavHttps,
      },
      typed === '' ? null : typed,
    );
    // The saved row is the new baseline for the unsaved-changes check. Native normalises what it
    // stores (an empty port becomes the default), so the form takes the row too, or it would stay
    // dirty; a rejected save keeps the user's edits.
    await loadSummary(saved);
  };

  const fieldError: {field: RepositoryField; error: CloudSyncError} | null =
    state.kind === 'failed' && state.error.field != null
      ? {field: state.error.field, error: state.error}
      : null;
  const errorFor = (field: RepositoryField) =>
    fieldError?.field === field ? (
      <HelperText type="error" visible>
        {fieldError.error.message}
      </HelperText>
    ) : null;

  const status = statusText(state);
  const statusColor =
    state.kind === 'connected' ? theme.colors.primary : theme.colors.error;
  const themed = useMemo(
    () =>
      StyleSheet.create({
        status: {color: statusColor},
        warning: {color: theme.colors.error},
      }),
    [statusColor, theme.colors.error],
  );

  if (loading) {
    return (
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
        <ActivityIndicator
          accessibilityLabel="Loading repository"
          style={styles.loading}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
      {/* Edge-to-edge stops adjustResize from shrinking the window, so this view makes room for the
          keyboard; the ScrollView then keeps the focused field in sight as it shrinks. */}
      <KeyboardAvoidingView behavior="padding" style={styles.keyboard}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled">
          <Text variant="bodyMedium">
            The server that holds your backup. SyncScope only reads file names,
            sizes and dates from it and never changes anything there.
          </Text>

          <View style={styles.field}>
            <Text variant="labelLarge">Server type</Text>
            <SegmentedButtons
              buttons={PROTOCOL_BUTTONS}
              onValueChange={value => set('protocol', value as RepositoryProtocol)}
              value={draft.protocol}
            />
            {errorFor('protocol')}
            {unencrypted ? (
              <Text
                accessibilityLabel="Unencrypted connection warning"
                style={themed.warning}
                variant="bodySmall">
                {UNENCRYPTED_WARNING}
              </Text>
            ) : null}
          </View>

          {draft.protocol === 'WEBDAV' ? (
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel} variant="bodyLarge">
                Use HTTPS
              </Text>
              <Switch
                accessibilityLabel="Use HTTPS"
                onValueChange={value => set('webdavHttps', value)}
                value={draft.webdavHttps}
              />
            </View>
          ) : null}

          <View>
            <TextInput
              accessibilityLabel="Host"
              autoCapitalize="none"
              autoCorrect={false}
              error={fieldError?.field === 'host'}
              keyboardType="url"
              label="Host"
              mode="outlined"
              onBlur={() => setDraft(withServerAddress)}
              onChangeText={value => set('host', value)}
              placeholder="nas.local or https://nas.local/dav"
              testID="repository.host"
              value={draft.host}
            />
            {errorFor('host')}
          </View>
          <View>
            <TextInput
              accessibilityLabel="Port"
              error={fieldError?.field === 'port'}
              keyboardType="number-pad"
              label="Port"
              mode="outlined"
              onChangeText={value => set('port', value)}
              testID="repository.port"
              placeholder={String(
                defaultPortFor(draft.protocol, draft.webdavHttps),
              )}
              value={draft.port}
            />
            {errorFor('port')}
          </View>
          <View>
            <TextInput
              accessibilityLabel="User name"
              autoCapitalize="none"
              autoCorrect={false}
              error={fieldError?.field === 'username'}
              label="User name"
              mode="outlined"
              onChangeText={value => set('username', value)}
              testID="repository.username"
              value={draft.username}
            />
            {errorFor('username')}
          </View>
          <View>
            <TextInput
              accessibilityLabel="Password"
              autoCapitalize="none"
              autoCorrect={false}
              error={fieldError?.field === 'password'}
              label="Password"
              mode="outlined"
              onChangeText={setPassword}
              secureTextEntry
              testID="repository.password"
              value={password}
            />
            {fieldError?.field === 'password' ? (
              errorFor('password')
            ) : credentialStored ? (
              <HelperText type="info" visible>
                {PASSWORD_STORED_HINT}
              </HelperText>
            ) : null}
          </View>
          <View>
            <TextInput
              accessibilityLabel="Remote folder"
              autoCapitalize="none"
              autoCorrect={false}
              error={fieldError?.field === 'remoteRoot'}
              label="Remote folder"
              mode="outlined"
              onChangeText={value => set('remoteRoot', value)}
              testID="repository.remoteRoot"
              placeholder="/photos"
              value={draft.remoteRoot}
            />
            {errorFor('remoteRoot')}
          </View>

          {isRunning ? (
            <Text variant="bodyMedium">A scan is running</Text>
          ) : null}
          <Button
            accessibilityLabel="Save and test"
            disabled={saveDisabled}
            mode="contained"
            onPress={save}>
            Save and test
          </Button>

          {busy ? (
            <View style={styles.progress}>
              <ProgressBar accessibilityLabel="Checking connection" indeterminate />
              <Text variant="bodyMedium">Connecting to the server…</Text>
            </View>
          ) : null}
          {status != null ? (
            <View style={styles.status}>
              <Text
                accessibilityLabel={status}
                style={themed.status}
                variant="titleSmall">
                {status}
              </Text>
              {state.kind === 'failed' && state.error.action ? (
                <Text variant="bodyMedium">{state.error.action}</Text>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <HostKeyDialog
        challenge={state.kind === 'hostKeyPrompt' ? state.challenge : null}
        changed={state.kind === 'hostKeyPrompt' && state.changed}
        onReject={reject}
        onTrust={trust}
      />
      <Portal>
        <Dialog
          onDismiss={() => setLeaveAction(null)}
          visible={leaveAction != null}>
          <Dialog.Title>Discard changes?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              Your changes to the repository have not been saved.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button
              accessibilityLabel="Keep editing"
              onPress={() => setLeaveAction(null)}>
              Keep editing
            </Button>
            <Button
              accessibilityLabel="Discard changes"
              onPress={() => {
                const action = leaveAction;
                setLeaveAction(null);
                if (action != null) {
                  leaving.current = true;
                  navigation.dispatch(action);
                }
              }}>
              Discard
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
    padding: spacing.xl,
  },
  field: {
    gap: spacing.sm,
  },
  keyboard: {
    flex: 1,
  },
  loading: {
    margin: spacing.xl,
  },
  progress: {
    gap: spacing.sm,
  },
  safeArea: {
    flex: 1,
  },
  status: {
    gap: spacing.xs,
  },
  switchLabel: {
    flex: 1,
  },
  switchRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
});
