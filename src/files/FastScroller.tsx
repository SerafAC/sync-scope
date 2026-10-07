import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
} from 'react-native';
import { Text, useTheme, type MD3Theme } from 'react-native-paper';

import type { ScrollBandDto, ScrollUnit } from '../native/CloudSyncContracts';
import { spacing } from '../theme/spacing';
import { scrollerLabel } from './a11y';
import { bandLabel } from './bandLabel';

/** Height of the draggable thumb, in dp. */
export const SCROLLER_THUMB_HEIGHT = 48;
/** The scroller fades out this long after scrolling stops (Story 2 sc. 1). */
export const SCROLLER_FADE_DELAY_MS = 1500;
/** It shows only for content taller than this many viewports (FR-006). */
export const SCROLLER_MIN_VIEWPORTS = 3;

const FADE_OUT_MS = 300;
const THUMB_TOUCH_WIDTH = 32;
const THUMB_WIDTH = 6;
/** After an accessibility step, scroll events this soon come from the step's own jump. */
const STEP_SETTLE_MS = 1000;

const ACTIONS = [
  { name: 'increment' as const },
  { name: 'decrement' as const },
];

export interface FastScrollerProps {
  unit: ScrollUnit;
  /** The scroll index's bands, in order (research R4). */
  bands: readonly ScrollBandDto[];
  /** Height of the list's whole content and of its viewport, in dp. */
  contentHeight: number;
  viewportHeight: number;
  /** The list's scroll offset; every change counts as scrolling. */
  scrollOffset: number;
  /**
   * The first visible file's position among the bands' files. The thumb sits
   * at the same fraction of the track that a drag maps to that file, so after
   * a jump it rests on the band it jumped to.
   */
  firstIndex: number;
  /** Scrolls the list to the file at [index] among the bands' files. */
  onJump: (index: number) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The band holding the file [fraction] of the way through the bands' files. */
function bandAt(bands: readonly ScrollBandDto[], fraction: number): number {
  const last = bands[bands.length - 1];
  if (last == null) {
    return 0;
  }
  const total = last.startIndex + last.count;
  const index = Math.min(total - 1, Math.floor(clamp(fraction, 0, 1) * total));
  let found = 0;
  bands.forEach((band, k) => {
    if (band.startIndex <= index) {
      found = k;
    }
  });
  return found;
}

function themedStyles(theme: MD3Theme) {
  return StyleSheet.create({
    bubble: { backgroundColor: theme.colors.primaryContainer },
    bubbleText: { color: theme.colors.onPrimaryContainer },
    pill: { backgroundColor: theme.colors.primary },
  });
}

/**
 * The scrollbar of a long gallery or list (007 FR-006–FR-008, research R9):
 * shown while the list scrolls and only when the content is more than three
 * viewports tall, faded out 1.5 s after scrolling stops. Dragging the thumb
 * shows the label of the band under it (`bandLabel`); releasing it jumps to
 * that band's first file. For TalkBack the thumb is adjustable: its value is
 * the current band and increment / decrement jump to the next or previous
 * band. A new result (new bands) while dragging ends the drag where the
 * finger reached. After a release the label stays until the scroller fades,
 * so the band reached can still be read.
 */
export function FastScroller({
  unit,
  bands,
  contentHeight,
  viewportHeight,
  scrollOffset,
  firstIndex,
  onJump,
}: FastScrollerProps): React.JSX.Element | null {
  const theme = useTheme();
  const themed = useMemo(() => themedStyles(theme), [theme]);
  const travel = Math.max(0, viewportHeight - SCROLLER_THUMB_HEIGHT);
  const last = bands[bands.length - 1];
  const total = last == null ? 0 : last.startIndex + last.count;
  const scrollTop =
    total <= 1 ? 0 : clamp(firstIndex / (total - 1), 0, 1) * travel;

  const [dragTop, setDragTop] = useState<number | null>(null);
  const [stepBand, setStepBand] = useState<number | null>(null);
  /** The released band's label, kept until the scroller has faded out. */
  const [released, setReleased] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const steppedAt = useRef(0);

  // Mirrors for the gesture handlers, which are created once.
  const latest = useRef({ unit, bands, travel, scrollTop, onJump });
  latest.current = { unit, bands, travel, scrollTop, onJump };
  const dragging = useRef<{ grantTop: number; top: number } | null>(null);

  const show = useCallback(() => {
    if (hideTimer.current != null) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    opacity.stopAnimation();
    opacity.setValue(1);
  }, [opacity]);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current != null) {
      clearTimeout(hideTimer.current);
    }
    hideTimer.current = setTimeout(() => {
      hideTimer.current = null;
      // The JS driver: `show` sets the value back to 1 at once on every
      // scroll event, which a native-driven value would only follow late.
      Animated.timing(opacity, {
        toValue: 0,
        duration: FADE_OUT_MS,
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished) {
          setReleased(null);
        }
      });
    }, SCROLLER_FADE_DELAY_MS);
  }, [opacity]);

  useEffect(
    () => () => {
      if (hideTimer.current != null) {
        clearTimeout(hideTimer.current);
      }
    },
    [],
  );

  const previousOffset = useRef(scrollOffset);
  useEffect(() => {
    if (previousOffset.current === scrollOffset) {
      return;
    }
    previousOffset.current = scrollOffset;
    show();
    if (dragging.current == null) {
      scheduleHide();
    }
    if (Date.now() - steppedAt.current > STEP_SETTLE_MS) {
      setStepBand(null);
    }
  }, [scrollOffset, show, scheduleHide]);

  /** Ends the drag at its reached position over [over] and jumps there. */
  const finishDrag = useCallback(
    (over: readonly ScrollBandDto[]) => {
      const drag = dragging.current;
      if (drag == null) {
        return;
      }
      dragging.current = null;
      setDragTop(null);
      const { travel: track, onJump: jump } = latest.current;
      const band = over[bandAt(over, track === 0 ? 0 : drag.top / track)];
      setReleased(band == null ? null : bandLabel(latest.current.unit, band));
      if (band != null) {
        jump(band.startIndex);
      }
      scheduleHide();
    },
    [scheduleHide],
  );

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          const top = latest.current.scrollTop;
          dragging.current = { grantTop: top, top };
          setStepBand(null);
          setReleased(null);
          setDragTop(top);
          show();
        },
        onPanResponderMove: (_event, gesture) => {
          const drag = dragging.current;
          if (drag == null) {
            return;
          }
          drag.top = clamp(
            drag.grantTop + gesture.dy,
            0,
            latest.current.travel,
          );
          setDragTop(drag.top);
        },
        onPanResponderRelease: () => finishDrag(latest.current.bands),
        onPanResponderTerminate: () => finishDrag(latest.current.bands),
      }),
    [finishDrag, show],
  );

  // A new result while dragging: the drag ends where the finger reached.
  const shownBands = useRef(bands);
  useEffect(() => {
    if (shownBands.current === bands) {
      return;
    }
    shownBands.current = bands;
    setStepBand(null);
    finishDrag(bands);
  }, [bands, finishDrag]);

  const positionBand = bandAt(
    bands,
    travel === 0 ? 0 : (dragTop ?? scrollTop) / travel,
  );
  const current =
    dragTop == null && stepBand != null && stepBand < bands.length
      ? stepBand
      : positionBand;
  const currentBand = bands[current];
  const label = currentBand == null ? '' : bandLabel(unit, currentBand);

  const onAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      const step =
        event.nativeEvent.actionName === 'increment'
          ? 1
          : event.nativeEvent.actionName === 'decrement'
          ? -1
          : 0;
      const next = clamp(current + step, 0, bands.length - 1);
      const band = bands[next];
      if (step === 0 || next === current || band == null) {
        return;
      }
      steppedAt.current = Date.now();
      setStepBand(next);
      onJump(band.startIndex);
    },
    [bands, current, onJump],
  );

  if (
    bands.length === 0 ||
    viewportHeight <= 0 ||
    contentHeight <= SCROLLER_MIN_VIEWPORTS * viewportHeight
  ) {
    return null;
  }

  const top = dragTop ?? scrollTop;
  const position = { transform: [{ translateY: top }] };
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.track, { opacity }]}
      testID="files.scroller"
    >
      {dragTop != null || released != null ? (
        <View
          style={[styles.bubble, themed.bubble, position]}
          testID="files.scroller.label"
        >
          <Text style={themed.bubbleText} variant="titleMedium">
            {dragTop != null ? label : released}
          </Text>
        </View>
      ) : null}
      <View
        {...pan.panHandlers}
        accessibilityActions={ACTIONS}
        accessibilityLabel={scrollerLabel()}
        accessibilityRole="adjustable"
        accessibilityValue={{ text: label }}
        accessible
        onAccessibilityAction={onAccessibilityAction}
        style={[styles.thumb, position]}
        testID="files.scroller.thumb"
      >
        <View style={[styles.pill, themed.pill]} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    borderRadius: spacing.xl,
    justifyContent: 'center',
    minHeight: SCROLLER_THUMB_HEIGHT,
    paddingHorizontal: spacing.lg,
    position: 'absolute',
    right: THUMB_TOUCH_WIDTH + spacing.sm,
    top: 0,
  },
  pill: {
    borderRadius: THUMB_WIDTH / 2,
    height: '100%',
    width: THUMB_WIDTH,
  },
  thumb: {
    alignItems: 'flex-end',
    height: SCROLLER_THUMB_HEIGHT,
    paddingRight: spacing.xs,
    position: 'absolute',
    right: 0,
    top: 0,
    width: THUMB_TOUCH_WIDTH,
  },
  track: {
    bottom: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    width: '100%',
  },
});
