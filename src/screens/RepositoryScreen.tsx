import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { getRepositorySummary } from '../native/CloudSync';
import {
  REPOSITORY_DEFAULT_PORTS,
  type RepositoryField,
  type RepositoryProtocol,
  type RepositorySummaryDto,
} from '../native/CloudSyncContracts';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { HostKeyDialog } from '../repository/HostKeyDialog';
import { RemoteFolderBrowser } from '../repository/RemoteFolderBrowser';
import {
  splitServerAddress,
  withFirstRemoteRoot,
} from '../repository/serverAddress';
import {
  NEW_REPOSITORY_DRAFT,
  draftOf,
  fieldErrorAt,
  folderResultAt,
  useRepository,
  withRemoteRoot,
  withRemoteRootAdded,
  withRemoteRootRemoved,
  type RepositoryDraft,
  type RepositoryFormState,
} from '../repository/useRepository';
import { useScan } from '../scan/useScan';
import { spacing } from '../theme/spacing';

type Props = NativeStackScreenProps<RootStackParamList, 'Repository'>;

const NEW_DRAFT = NEW_REPOSITORY_DRAFT;

const PROTOCOL_BUTTONS = [
  { value: 'FTP', label: 'FTP', accessibilityLabel: 'Protocol FTP' },
  { value: 'SFTP', label: 'SFTP', accessibilityLabel: 'Protocol SFTP' },
  { value: 'WEBDAV', label: 'WebDAV', accessibilityLabel: 'Protocol WebDAV' },
];

export const UNENCRYPTED_WARNING =
  'The password and file names are sent unencrypted. Use only on a network you trust.';
export const PASSWORD_STORED_HINT =
  'A password is stored. Leave empty to keep it.';

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
 * user name, and (FTP/SFTP only) the first remote folder. WebDAV keeps its shared path in Host
 * without changing any folder (Story 3 sc. 8). A URL that switches the protocol but names no port clears the port, so the new
 * protocol's default applies.
 */
export function withServerAddress(draft: RepositoryDraft): RepositoryDraft {
  const parts = splitServerAddress(draft.host, draft.protocol);
  if (parts == null) {
    return draft;
  }
  const { remoteRoot, ...fields } = parts;
  const protocolChanged =
    fields.protocol != null && fields.protocol !== draft.protocol;
  return {
    ...draft,
    ...fields,
    port: fields.port ?? (protocolChanged ? '' : draft.port),
    remoteRoots: withFirstRemoteRoot(draft.remoteRoots, remoteRoot),
  };
}

function sameDraft(a: RepositoryDraft, b: RepositoryDraft): boolean {
  return (
    a.protocol === b.protocol &&
    a.host === b.host &&
    a.port === b.port &&
    a.username === b.username &&
    a.remoteRoots.length === b.remoteRoots.length &&
    a.remoteRoots.every((root, i) => root === b.remoteRoots[i]) &&
    (a.protocol !== 'WEBDAV' || a.webdavHttps === b.webdavHttps)
  );
}

/** Empty → null (the default port); anything else is sent as a number for native to validate. */
function portValue(text: string): number | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : Number(trimmed);
}

/** A passed test's line for one folder: its entry count, or that it could not be read. */
export function folderLineText(
  path: string,
  entryCount: number | null,
): string {
  return entryCount != null
    ? `${path}: ${entryCount} entries`
    : `${path}: could not be read`;
}

function statusText(state: RepositoryFormState): string | null {
  switch (state.kind) {
    case 'connected':
      return 'Connected';
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
export function RepositoryScreen({ navigation }: Props): React.JSX.Element {
  const theme = useTheme();
  const { isRunning } = useScan();
  const { state, busy, saveAndTest, trust, reject } = useRepository();

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
  ) => setDraft(current => ({ ...current, [key]: value }));

  // What Save sends: a URL in Host already split up, even before the field loses focus.
  const resolved = useMemo(() => withServerAddress(draft), [draft]);

  const credentialStored = summary?.credentialPresent === true;
  const missingRequired =
    resolved.host.trim() === '' ||
    resolved.username.trim() === '' ||
    resolved.remoteRoots.every(root => root.trim() === '') ||
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
        // Every field, blank ones too, so a save error's fieldIndex names the field shown.
        remoteRoots: resolved.remoteRoots.map(root => root.trim()),
        webdavHttps: resolved.protocol === 'WEBDAV' && resolved.webdavHttps,
      },
      typed === '' ? null : typed,
    );
    // The saved row is the new baseline for the unsaved-changes check. Native normalises what it
    // stores (an empty port becomes the default), so the form takes the row too, or it would stay
    // dirty; a rejected save keeps the user's edits.
    await loadSummary(saved);
  };

  const hasError = (field: RepositoryField, index = 0) =>
    fieldErrorAt(state, field, index) != null;
  const errorFor = (field: RepositoryField, index = 0) => {
    const error = fieldErrorAt(state, field, index);
    return error != null ? (
      <HelperText type="error" visible>
        {error.message}
      </HelperText>
    ) : null;
  };

  // The folder field whose Browse button opened the server folder browser.
  const [browsing, setBrowsing] = useState<number | null>(null);

  const status = statusText(state);
  const statusColor =
    state.kind === 'connected' ? theme.colors.primary : theme.colors.error;
  const themed = useMemo(
    () =>
      StyleSheet.create({
        status: { color: statusColor },
        warning: { color: theme.colors.error },
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
          keyboardShouldPersistTaps="handled"
        >
          <Text variant="bodyMedium">
            The server that holds your backup. SyncScope only reads file names,
            sizes and dates from it and never changes anything there.
          </Text>

          <View style={styles.field}>
            <Text variant="labelLarge">Server type</Text>
            <SegmentedButtons
              buttons={PROTOCOL_BUTTONS}
              onValueChange={value =>
                set('protocol', value as RepositoryProtocol)
              }
              value={draft.protocol}
            />
            {errorFor('protocol')}
            {unencrypted ? (
              <Text
                accessibilityLabel="Unencrypted connection warning"
                style={themed.warning}
                variant="bodySmall"
              >
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
              error={hasError('host')}
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
            {draft.protocol === 'WEBDAV' ? (
              <HelperText type="info" visible>
                Include the WebDAV path shared by all folders, for example
                nas.local/remote.php/dav/alice. Remote folders are relative to
                this address; use / for its top folder.
              </HelperText>
            ) : null}
          </View>
          <View>
            <TextInput
              accessibilityLabel="Port"
              error={hasError('port')}
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
              error={hasError('username')}
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
              error={hasError('password')}
              label="Password"
              mode="outlined"
              onChangeText={setPassword}
              secureTextEntry
              testID="repository.password"
              value={password}
            />
            {hasError('password') ? (
              errorFor('password')
            ) : credentialStored ? (
              <HelperText type="info" visible>
                {PASSWORD_STORED_HINT}
              </HelperText>
            ) : null}
          </View>
          {draft.remoteRoots.map((root, index) => {
            const number = index + 1;
            const line = folderResultAt(state, index);
            return (
              // Fields are positional: the index is the field's identity.
              <View key={index}>
                <TextInput
                  accessibilityLabel={`Remote folder ${number}`}
                  autoCapitalize="none"
                  autoCorrect={false}
                  error={hasError('remoteRoots', index) || line?.error != null}
                  label={`Remote folder ${number}`}
                  mode="outlined"
                  onChangeText={value =>
                    setDraft(current => withRemoteRoot(current, index, value))
                  }
                  testID={`repository.remoteRoots.${index}`}
                  placeholder="/photos"
                  value={root}
                />
                {errorFor('remoteRoots', index)}
                {line?.error != null ? (
                  <>
                    <HelperText type="error" visible>
                      {line.error.message}
                    </HelperText>
                    {line.error.action ? (
                      <HelperText type="info" visible>
                        {line.error.action}
                      </HelperText>
                    ) : null}
                  </>
                ) : null}
                <View style={styles.folderActions}>
                  <Button
                    accessibilityLabel={`Browse remote folder ${number}`}
                    compact
                    disabled={busy}
                    icon="folder-search-outline"
                    onPress={() => setBrowsing(index)}
                  >
                    Browse
                  </Button>
                  {draft.remoteRoots.length > 1 ? (
                    <Button
                      accessibilityLabel={`Remove remote folder ${number}`}
                      compact
                      disabled={busy}
                      icon="close"
                      onPress={() =>
                        setDraft(current =>
                          withRemoteRootRemoved(current, index),
                        )
                      }
                    >
                      Remove
                    </Button>
                  ) : null}
                </View>
              </View>
            );
          })}
          <Button
            accessibilityLabel="Add another folder"
            disabled={busy}
            icon="plus"
            onPress={() => setDraft(withRemoteRootAdded)}
            style={styles.addFolder}
          >
            Add another folder
          </Button>

          {isRunning ? (
            <Text variant="bodyMedium">A scan is running</Text>
          ) : null}
          <Button
            accessibilityLabel="Save and test"
            disabled={saveDisabled}
            mode="contained"
            onPress={save}
          >
            Save and test
          </Button>

          {busy ? (
            <View style={styles.progress}>
              <ProgressBar
                accessibilityLabel="Checking connection"
                indeterminate
              />
              <Text variant="bodyMedium">Connecting to the server…</Text>
            </View>
          ) : null}
          {status != null ? (
            <View style={styles.status}>
              <Text
                accessibilityLabel={status}
                style={themed.status}
                variant="titleSmall"
              >
                {status}
              </Text>
              {state.kind === 'failed' && state.error.action ? (
                <Text variant="bodyMedium">{state.error.action}</Text>
              ) : null}
              {state.kind === 'connected'
                ? state.folders.map(folder => {
                    const text = folderLineText(folder.path, folder.entryCount);
                    return (
                      <Text
                        accessibilityLabel={text}
                        key={folder.path}
                        style={
                          folder.error != null ? themed.warning : undefined
                        }
                        variant="bodyMedium"
                      >
                        {text}
                      </Text>
                    );
                  })
                : null}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <RemoteFolderBrowser
        config={{
          protocol: resolved.protocol,
          host: resolved.host.trim(),
          port: portValue(resolved.port),
          username: resolved.username,
          webdavHttps: resolved.protocol === 'WEBDAV' && resolved.webdavHttps,
        }}
        initialPath={
          browsing != null ? resolved.remoteRoots[browsing] ?? '' : ''
        }
        onClose={() => setBrowsing(null)}
        onUse={path => {
          if (browsing != null) {
            const index = browsing;
            setDraft(current =>
              withRemoteRoot(withServerAddress(current), index, path),
            );
          }
          setBrowsing(null);
        }}
        password={password === '' ? null : password}
        visible={browsing != null}
      />
      <HostKeyDialog
        challenge={state.kind === 'hostKeyPrompt' ? state.challenge : null}
        changed={state.kind === 'hostKeyPrompt' && state.changed}
        onReject={reject}
        onTrust={trust}
      />
      <Portal>
        <Dialog
          onDismiss={() => setLeaveAction(null)}
          visible={leaveAction != null}
        >
          <Dialog.Title>Discard changes?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              Your changes to the repository have not been saved.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button
              accessibilityLabel="Keep editing"
              onPress={() => setLeaveAction(null)}
            >
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
              }}
            >
              Discard
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  addFolder: {
    alignSelf: 'flex-start',
  },
  content: {
    gap: spacing.lg,
    padding: spacing.xl,
  },
  field: {
    gap: spacing.sm,
  },
  folderActions: {
    flexDirection: 'row',
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
