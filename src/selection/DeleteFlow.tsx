import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StyleSheet, View } from 'react-native';
import { NavigationContext } from '@react-navigation/native';
import {
  ActivityIndicator,
  Button,
  Checkbox,
  Dialog,
  Portal,
  Text,
  TouchableRipple,
  useTheme,
} from 'react-native-paper';

import { GoThereButton } from '../navigation/fixTargets';
import {
  executeLocalDeletion,
  prepareLocalDeletion,
} from '../native/CloudSync';
import {
  CloudSyncErrorCode,
  STALE_REMOTE_LISTING_MILLIS,
  type CloudSyncError,
  type DeletionFailureReason,
  type DeletionPlanDto,
  type DeletionResultDto,
} from '../native/CloudSyncContracts';
import { RESCAN_SUGGESTED_TEXT, formatAge } from '../scan/ScanSummaryCard';
import { spacing } from '../theme/spacing';
import { formatBytes } from './formatBytes';

/** Why an attempted file was not deleted: the one place these texts live. */
export const DELETION_REASON_TEXT: Readonly<
  Record<DeletionFailureReason, string>
> = {
  ALREADY_GONE: 'Already gone',
  CHANGED: 'Changed since the scan',
  ACCESS_LOST: 'No permission to delete in this folder',
  FAILED: 'Could not be deleted',
};

/** Execute refusals after which the selection must be reviewed again. */
const REVIEW_AGAIN_CODES: ReadonlySet<string> = new Set([
  CloudSyncErrorCode.PLAN_STALE,
  CloudSyncErrorCode.PLAN_NOT_FOUND,
]);

const INCLUDE_UNSYNCED = 'Also delete files that are not backed up';

const UNSYNCED_WARNING =
  'These files exist only on this phone. Deleting them cannot be undone.';

type Step =
  | { kind: 'checking' }
  | { kind: 'error'; error: CloudSyncError }
  | { kind: 'confirm'; plan: DeletionPlanDto }
  | { kind: 'deleting'; count: number }
  | { kind: 'result'; result: DeletionResultDto };

export interface DeleteFlowProps {
  /** The dialog sequence runs while true; each opening starts a new check. */
  visible: boolean;
  snapshotId: string;
  entryIds: readonly string[];
  /** Cancel, or Done after an error or a result. */
  onDismiss: () => void;
  /** Called once per finished deletion, as soon as the result is known. */
  onDeleted: (result: DeletionResultDto) => void;
  /** The time the scan age is measured against; defaults to now. */
  now?: () => number;
}

/**
 * The two-phase delete dialog (Story 6, research R12–R13): checks the
 * selection on the server, shows what would happen, and deletes only after
 * the user confirms. Files that are not backed up are deleted only after the
 * checkbox and a second, explicit confirmation; unknown-state files never
 * are. Every labelled element is a Maestro selector (contracts/maestro-mvp.md).
 */
export function DeleteFlow({
  visible,
  snapshotId,
  entryIds,
  onDismiss,
  onDeleted,
  now = Date.now,
}: DeleteFlowProps): React.JSX.Element {
  const theme = useTheme();
  const themed = useMemo(
    () => StyleSheet.create({ warning: { color: theme.colors.error } }),
    [theme.colors.error],
  );
  const [step, setStep] = useState<Step>({ kind: 'checking' });
  const [includeChecked, setIncludeChecked] = useState(false);
  const [unsyncedConfirmed, setUnsyncedConfirmed] = useState(false);
  // Each check or delete gets a number; a reply for an older one is dropped.
  const attempt = useRef(0);
  // Read at check time, so a re-render with a new array never restarts a check.
  const selection = useRef({ snapshotId, entryIds });
  selection.current = { snapshotId, entryIds };

  const check = useCallback(async () => {
    const mine = ++attempt.current;
    setStep({ kind: 'checking' });
    setIncludeChecked(false);
    setUnsyncedConfirmed(false);
    const prepared = await prepareLocalDeletion(
      selection.current.snapshotId,
      selection.current.entryIds,
    );
    if (mine !== attempt.current) {
      return;
    }
    setStep(
      prepared.status === 'ok'
        ? { kind: 'confirm', plan: prepared.plan }
        : { kind: 'error', error: prepared.error },
    );
  }, []);

  useEffect(() => {
    if (visible) {
      check();
    }
    return () => {
      attempt.current += 1;
    };
  }, [visible, check]);

  const includeUnsynced = includeChecked && unsyncedConfirmed;

  const remove = async (plan: DeletionPlanDto) => {
    const mine = ++attempt.current;
    const count =
      plan.toDelete.count + (includeUnsynced ? plan.unsynced.count : 0);
    setStep({ kind: 'deleting', count });
    const executed = await executeLocalDeletion(
      plan.planToken,
      includeUnsynced,
    );
    if (mine !== attempt.current) {
      return;
    }
    if (executed.status === 'error') {
      setStep({ kind: 'error', error: executed.error });
      return;
    }
    setStep({ kind: 'result', result: executed.result });
    onDeleted(executed.result);
  };

  const toggleInclude = () => {
    setIncludeChecked(checked => !checked);
    setUnsyncedConfirmed(false);
  };

  // Paper renders a Portal in PaperProvider's host, outside the
  // NavigationContainer, so the screen's navigation is handed into the dialog
  // for "Go there" (GoThereButton's useNavigation).
  const navigation = useContext(NavigationContext);

  return (
    <Portal>
      <NavigationContext.Provider value={navigation}>
        <Dialog
          dismissable={step.kind !== 'deleting'}
          onDismiss={onDismiss}
          visible={visible}
        >
          {step.kind === 'checking' ? (
            <DialogStep>
              <Dialog.Content style={styles.row}>
                <ActivityIndicator accessibilityLabel="Checking" />
                <Text
                  accessibilityLabel="Checking files on the server"
                  variant="bodyLarge"
                >
                  Checking files on the server
                </Text>
              </Dialog.Content>
              <Dialog.Actions>
                <Button accessibilityLabel="Cancel" onPress={onDismiss}>
                  Cancel
                </Button>
              </Dialog.Actions>
            </DialogStep>
          ) : null}

          {step.kind === 'error' ? (
            <DialogStep>
              <Dialog.Title>Nothing was deleted</Dialog.Title>
              <Dialog.Content style={styles.content}>
                <Text style={themed.warning} variant="bodyMedium">
                  {step.error.message}
                </Text>
                {step.error.action ? (
                  <Text variant="bodyMedium">{step.error.action}</Text>
                ) : null}
              </Dialog.Content>
              <Dialog.Actions>
                <GoThereButton code={step.error.code} onGo={onDismiss} />
                <Button accessibilityLabel="Cancel" onPress={onDismiss}>
                  Cancel
                </Button>
                {REVIEW_AGAIN_CODES.has(step.error.code) ? (
                  <Button accessibilityLabel="Review again" onPress={check}>
                    Review again
                  </Button>
                ) : (
                  <Button accessibilityLabel="Retry" onPress={check}>
                    Retry
                  </Button>
                )}
              </Dialog.Actions>
            </DialogStep>
          ) : null}

          {step.kind === 'confirm' ? (
            <Confirmation
              includeChecked={includeChecked}
              includeUnsynced={includeUnsynced}
              now={now()}
              onCancel={onDismiss}
              onConfirmUnsynced={() => setUnsyncedConfirmed(true)}
              onDelete={() => remove(step.plan)}
              onToggleInclude={toggleInclude}
              plan={step.plan}
              unsyncedConfirmed={unsyncedConfirmed}
              warningStyle={themed.warning}
            />
          ) : null}

          {step.kind === 'deleting' ? (
            <Dialog.Content style={styles.row}>
              <ActivityIndicator accessibilityLabel="Deleting" />
              <Text variant="bodyLarge">{`Deleting ${step.count} files…`}</Text>
            </Dialog.Content>
          ) : null}

          {step.kind === 'result' ? (
            <DialogStep>
              <Dialog.Content style={styles.content}>
                <Text
                  accessibilityLabel={`Deleted ${
                    step.result.deleted
                  } files, freed ${formatBytes(step.result.freedBytes)}`}
                  variant="titleMedium"
                >
                  {`Deleted ${step.result.deleted} files, freed ${formatBytes(
                    step.result.freedBytes,
                  )}`}
                </Text>
                {step.result.failures.map(failure => {
                  const line = `Could not delete ${failure.name}: ${
                    DELETION_REASON_TEXT[failure.reason]
                  }`;
                  return (
                    <Text
                      accessibilityLabel={line}
                      key={failure.entryId}
                      variant="bodyMedium"
                    >
                      {line}
                    </Text>
                  );
                })}
              </Dialog.Content>
              <Dialog.Actions>
                <Button accessibilityLabel="Done" onPress={onDismiss}>
                  Done
                </Button>
              </Dialog.Actions>
            </DialogStep>
          ) : null}
        </Dialog>
      </NavigationContext.Provider>
    </Portal>
  );
}

/**
 * Groups one step's title, content and actions. Paper's `Dialog` passes a
 * `style` to its direct children, which a bare Fragment rejects with a
 * development warning; this component takes it and ignores it, as
 * `Confirmation` does.
 */
function DialogStep({
  children,
}: {
  children: React.ReactNode;
  style?: unknown;
}): React.JSX.Element {
  return <>{children}</>;
}

interface ConfirmationProps {
  plan: DeletionPlanDto;
  now: number;
  includeChecked: boolean;
  unsyncedConfirmed: boolean;
  includeUnsynced: boolean;
  warningStyle: { color: string };
  onToggleInclude: () => void;
  onConfirmUnsynced: () => void;
  onDelete: () => void;
  onCancel: () => void;
}

/** Step 3: the breakdown, the not-backed-up opt-in and the permanence note. */
function Confirmation({
  plan,
  now,
  includeChecked,
  unsyncedConfirmed,
  includeUnsynced,
  warningStyle,
  onToggleInclude,
  onConfirmUnsynced,
  onDelete,
  onCancel,
}: ConfirmationProps): React.JSX.Element {
  const backedUp = `Delete ${
    plan.toDelete.count
  } backed-up files, ${formatBytes(plan.toDelete.bytes)}`;
  const age = formatAge(plan.remoteListedAtMillis, now);
  const stale = now - plan.remoteListedAtMillis > STALE_REMOTE_LISTING_MILLIS;
  const deletable =
    plan.toDelete.count + (includeUnsynced ? plan.unsynced.count : 0);

  return (
    <>
      <Dialog.Title>Delete from this phone?</Dialog.Title>
      <Dialog.Content style={styles.content}>
        <Text accessibilityLabel={backedUp} variant="titleMedium">
          {backedUp}
        </Text>

        {plan.unsynced.count > 0 ? (
          <View style={styles.group}>
            <Text
              accessibilityLabel={`Not backed up ${plan.unsynced.count}`}
              variant="bodyMedium"
            >
              {`Not backed up: ${plan.unsynced.count} (${formatBytes(
                plan.unsynced.bytes,
              )}), kept unless you include them`}
            </Text>
            {/* One tap target for the whole row; the box and text inside are
                hidden from accessibility, so the row is read once. */}
            <TouchableRipple
              accessibilityLabel={INCLUDE_UNSYNCED}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: includeChecked }}
              onPress={onToggleInclude}
            >
              <View
                importantForAccessibility="no-hide-descendants"
                pointerEvents="none"
                style={styles.row}
              >
                <Checkbox.Android
                  accessibilityLabel={INCLUDE_UNSYNCED}
                  status={includeChecked ? 'checked' : 'unchecked'}
                />
                <Text style={styles.flex} variant="bodyMedium">
                  {INCLUDE_UNSYNCED}
                </Text>
              </View>
            </TouchableRipple>
            {includeChecked ? (
              <>
                <Text style={warningStyle} variant="bodyMedium">
                  {UNSYNCED_WARNING}
                </Text>
                <Button
                  accessibilityLabel="Confirm not backed up"
                  accessibilityState={{ selected: unsyncedConfirmed }}
                  disabled={unsyncedConfirmed}
                  icon={unsyncedConfirmed ? 'check' : 'alert-outline'}
                  mode="outlined"
                  onPress={onConfirmUnsynced}
                  textColor={warningStyle.color}
                >
                  {unsyncedConfirmed
                    ? 'Not backed up files included'
                    : 'Confirm not backed up'}
                </Button>
              </>
            ) : null}
          </View>
        ) : null}

        {plan.refused.count > 0 ? (
          <View style={styles.group}>
            <Text
              accessibilityLabel={`Never deleted ${plan.refused.count}`}
              variant="bodyMedium"
            >
              {`Never deleted: ${plan.refused.count}. Their backup state is unknown.`}
            </Text>
            {plan.refused.scanTooOld > 0 ? (
              <Text variant="bodySmall">
                {`${plan.refused.scanTooOld} of them: Scan again to delete these.`}
              </Text>
            ) : null}
          </View>
        ) : null}

        {plan.movedByRecheck > 0 ? (
          <Text
            accessibilityLabel={`Moved by server check ${plan.movedByRecheck}`}
            variant="bodyMedium"
          >
            {`Moved by server check: ${plan.movedByRecheck} no longer match the backup`}
          </Text>
        ) : null}

        {plan.unknownSizeCount > 0 ? (
          <Text variant="bodySmall">
            {`${plan.unknownSizeCount} of unknown size, not counted in the total`}
          </Text>
        ) : null}

        {plan.missing > 0 ? (
          <Text variant="bodySmall">
            {`${plan.missing} no longer in the results`}
          </Text>
        ) : null}

        <Text accessibilityLabel={`Scan age ${age}`} variant="bodySmall">
          {`Scan from ${age}`}
        </Text>
        {stale ? (
          <Text accessibilityLabel="Rescan suggested" variant="bodySmall">
            {RESCAN_SUGGESTED_TEXT}
          </Text>
        ) : null}

        <Text variant="bodyMedium">Deleted files cannot be recovered.</Text>
      </Dialog.Content>
      <Dialog.Actions>
        <Button accessibilityLabel="Cancel" onPress={onCancel}>
          Cancel
        </Button>
        <Button
          accessibilityLabel="Delete"
          disabled={deletable === 0}
          mode="contained"
          onPress={onDelete}
        >
          Delete
        </Button>
      </Dialog.Actions>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  group: {
    gap: spacing.xs,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
});
