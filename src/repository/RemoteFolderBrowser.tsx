import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Modal, ScrollView, StyleSheet, View} from 'react-native';
import {
  ActivityIndicator,
  Button,
  List,
  Portal,
  Text,
  useTheme,
} from 'react-native-paper';
import {SafeAreaView} from 'react-native-safe-area-context';

import {
  approveSftpHostKey,
  browseRemoteFolders,
  rejectSftpHostKey,
} from '../native/CloudSync';
import {
  CloudSyncErrorCode,
  type CloudSyncError,
  type HostKeyChallengeDto,
  type RemoteBrowseConfigInput,
  type RemoteFoldersDto,
} from '../native/CloudSyncContracts';
import {spacing} from '../theme/spacing';
import {HostKeyDialog} from './HostKeyDialog';

export interface RemoteFolderBrowserProps {
  /** The browser is shown while true; it starts afresh each time it opens. */
  visible: boolean;
  /** The form's current draft: the server to browse. Nothing in it is saved. */
  config: RemoteBrowseConfigInput;
  /** The password typed in the form, or null to use the stored one for the same account. */
  password: string | null;
  /** The folder field's path, where browsing starts; empty starts at the top. */
  initialPath: string;
  /** "Use this folder": the folder being shown. */
  onUse: (path: string) => void;
  onClose: () => void;
}

/** Shown when a wrapper throws instead of resolving an envelope. */
const UNAVAILABLE_ERROR: CloudSyncError = {
  code: CloudSyncErrorCode.NATIVE_MODULE_UNAVAILABLE,
  message: 'The repository service is not available.',
  action: 'Restart the app.',
};

/** The form's text for a rejected key (RepositoryScreen), so both read alike. */
export const KEY_REJECTED_TEXT =
  'Server key rejected. The server is not trusted.';

export const FELL_BACK_TEXT =
  'That folder could not be opened, so the top folder is shown.';

type BrowserState =
  | {kind: 'loading'; listing: RemoteFoldersDto | null}
  | {kind: 'listed'; listing: RemoteFoldersDto}
  | {kind: 'failed'; listing: RemoteFoldersDto | null; error: CloudSyncError}
  | {
      kind: 'hostKeyPrompt';
      listing: RemoteFoldersDto | null;
      challenge: HostKeyChallengeDto;
      changed: boolean;
    }
  | {kind: 'rejected'; listing: RemoteFoldersDto | null};

function childPath(parent: string, name: string): string {
  return parent === '/' ? `/${name}` : `${parent}/${name}`;
}

/** `/`, then each folder above [path], then [path] itself, as [label, path] pairs. */
function crumbsOf(path: string): {label: string; path: string}[] {
  const crumbs = [{label: 'Top', path: '/'}];
  let current = '';
  for (const name of path.split('/').filter(part => part !== '')) {
    current = `${current}/${name}`;
    crumbs.push({label: name, path: current});
  }
  return crumbs;
}

function FolderIcon({color}: {color: string}): React.JSX.Element {
  return <List.Icon color={color} icon="folder-outline" />;
}

/**
 * The server folder browser (research R13, Story 3 sc. 11, 12): a modal over
 * the repository form that lists the folders on the server the draft
 * describes, with a breadcrumb, `Up`, one row per folder and `Use this folder`.
 * It saves nothing; the typed password stays in the form's state and is only
 * passed to each native call.
 *
 * A listing that fails shows the same cause and next step as the connection
 * test. An SFTP key that is not trusted yet opens the [HostKeyDialog]; after
 * trusting it the same folder is listed again. Answers for a folder the user
 * already left are ignored (a request sequence number, as in usePagedQuery).
 */
export function RemoteFolderBrowser({
  visible,
  config,
  password,
  initialPath,
  onUse,
  onClose,
}: RemoteFolderBrowserProps): React.JSX.Element {
  const theme = useTheme();
  const errorColor = theme.colors.error;
  const themed = useMemo(
    () => StyleSheet.create({error: {color: errorColor}}),
    [errorColor],
  );
  const [state, setState] = useState<BrowserState>({
    kind: 'loading',
    listing: null,
  });

  // The latest props, read by each request without restarting the browser.
  const latest = useRef({config, password, initialPath});
  latest.current = {config, password, initialPath};
  const sequence = useRef(0);
  const mounted = useRef(true);
  // The folder the last request asked for, listed again after a retry or a trusted key.
  const requested = useRef<string>('');
  const listingRef = useRef<RemoteFoldersDto | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const show = useCallback((next: BrowserState) => {
    listingRef.current = next.listing;
    setState(next);
  }, []);

  const load = useCallback(
    async (path: string) => {
      const id = ++sequence.current;
      requested.current = path;
      show({kind: 'loading', listing: listingRef.current});
      const current = () => mounted.current && id === sequence.current;
      try {
        const result = await browseRemoteFolders(
          latest.current.config,
          latest.current.password,
          path,
        );
        if (!current()) {
          return;
        }
        if (result.status === 'ok') {
          show({kind: 'listed', listing: result.remoteFolders});
          return;
        }
        const {error} = result;
        const challenge = error.hostKeyChallenge;
        if (
          challenge != null &&
          (error.code === CloudSyncErrorCode.SFTP_HOST_KEY_UNVERIFIED ||
            error.code === CloudSyncErrorCode.SFTP_HOST_KEY_CHANGED)
        ) {
          show({
            kind: 'hostKeyPrompt',
            listing: listingRef.current,
            challenge,
            changed: error.code === CloudSyncErrorCode.SFTP_HOST_KEY_CHANGED,
          });
          return;
        }
        show({kind: 'failed', listing: listingRef.current, error});
      } catch {
        if (current()) {
          show({
            kind: 'failed',
            listing: listingRef.current,
            error: UNAVAILABLE_ERROR,
          });
        }
      }
    },
    [show],
  );

  // Each opening starts at the field's path with nothing listed; closing drops any late answer.
  useEffect(() => {
    if (!visible) {
      sequence.current++;
      return;
    }
    listingRef.current = null;
    load(latest.current.initialPath.trim());
  }, [visible, load]);

  const answerKey = async (trust: boolean) => {
    if (state.kind !== 'hostKeyPrompt') {
      return;
    }
    const {challengeId} = state.challenge;
    const id = ++sequence.current;
    show({kind: 'loading', listing: listingRef.current});
    try {
      const answered = trust
        ? await approveSftpHostKey(challengeId)
        : await rejectSftpHostKey(challengeId);
      if (!mounted.current || id !== sequence.current) {
        return;
      }
      if (answered.status !== 'ok') {
        show({
          kind: 'failed',
          listing: listingRef.current,
          error: answered.error,
        });
      } else if (trust) {
        await load(requested.current);
      } else {
        show({kind: 'rejected', listing: listingRef.current});
      }
    } catch {
      if (mounted.current && id === sequence.current) {
        show({
          kind: 'failed',
          listing: listingRef.current,
          error: UNAVAILABLE_ERROR,
        });
      }
    }
  };

  const listing = state.listing;
  const loading = state.kind === 'loading';
  const shownListing = state.kind === 'listed' ? state.listing : null;

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent={false}
      visible={visible}>
      <Portal.Host>
        <SafeAreaView style={styles.safeArea} testID="remote-browser">
          <View style={styles.header}>
            <Text accessibilityRole="header" variant="titleLarge">
              Choose a remote folder
            </Text>
            <ScrollView
              contentContainerStyle={styles.crumbs}
              horizontal
              keyboardShouldPersistTaps="handled">
              {crumbsOf(listing?.path ?? '/').map((crumb, index, all) => (
                <Button
                  accessibilityLabel={`Go to ${crumb.path}`}
                  compact
                  // Enabled while loading too: leaving a slow folder drops its late answer.
                  disabled={!loading && index === all.length - 1}
                  key={crumb.path}
                  onPress={() => load(crumb.path)}>
                  {index === 0 ? crumb.label : `› ${crumb.label}`}
                </Button>
              ))}
            </ScrollView>
            <Button
              accessibilityLabel="Up one folder"
              disabled={listing?.parent == null}
              icon="arrow-up"
              mode="outlined"
              onPress={() => {
                if (listing?.parent != null) {
                  load(listing.parent);
                }
              }}
              style={styles.up}>
              Up
            </Button>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            {loading ? (
              <ActivityIndicator
                accessibilityLabel="Loading folders"
                style={styles.loading}
              />
            ) : null}
            {state.kind === 'failed' ? (
              <View style={styles.message}>
                <Text
                  accessibilityLabel={`Connection failed: ${state.error.message}`}
                  style={themed.error}
                  variant="titleSmall">
                  {`Connection failed: ${state.error.message}`}
                </Text>
                {state.error.action ? (
                  <Text variant="bodyMedium">{state.error.action}</Text>
                ) : null}
                <Button
                  accessibilityLabel="Try again"
                  mode="outlined"
                  onPress={() => load(requested.current)}>
                  Try again
                </Button>
              </View>
            ) : null}
            {state.kind === 'rejected' ? (
              <Text style={themed.error} variant="titleSmall">
                {KEY_REJECTED_TEXT}
              </Text>
            ) : null}
            {shownListing?.fellBackToRoot ? (
              <Text variant="bodyMedium">{FELL_BACK_TEXT}</Text>
            ) : null}
            {shownListing != null && shownListing.folders.length === 0 ? (
              <Text variant="bodyMedium">No folders here</Text>
            ) : null}
            {shownListing?.folders.map(name => (
              <List.Item
                accessibilityLabel={name}
                key={name}
                left={FolderIcon}
                onPress={() => load(childPath(shownListing.path, name))}
                title={name}
              />
            ))}
          </ScrollView>

          <View style={styles.actions}>
            <Button accessibilityLabel="Close folder browser" onPress={onClose}>
              Cancel
            </Button>
            <Button
              accessibilityLabel="Use this folder"
              disabled={shownListing == null}
              mode="contained"
              onPress={() => {
                if (shownListing != null) {
                  onUse(shownListing.path);
                }
              }}>
              Use this folder
            </Button>
          </View>
        </SafeAreaView>
        <HostKeyDialog
          challenge={state.kind === 'hostKeyPrompt' ? state.challenge : null}
          changed={state.kind === 'hostKeyPrompt' && state.changed}
          onReject={() => answerKey(false)}
          onTrust={() => answerKey(true)}
        />
      </Portal.Host>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    padding: spacing.lg,
  },
  body: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  crumbs: {
    alignItems: 'center',
  },
  header: {
    gap: spacing.sm,
    padding: spacing.lg,
  },
  loading: {
    margin: spacing.xl,
  },
  message: {
    gap: spacing.sm,
  },
  safeArea: {
    flex: 1,
  },
  up: {
    alignSelf: 'flex-start',
  },
});
