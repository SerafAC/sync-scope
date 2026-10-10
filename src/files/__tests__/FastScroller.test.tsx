import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import type { ScrollBandDto } from '../../native/CloudSyncContracts';
import { a11ySweep } from '../../test-utils/a11ySweep';
import { scrollerLabel } from '../a11y';
import {
  FastScroller,
  SCROLLER_FADE_DELAY_MS,
  SCROLLER_THUMB_HEIGHT,
  type FastScrollerProps,
} from '../FastScroller';

/** Four letter bands of 250 files: a, b, c, d. */
function letterBands(letters = ['a', 'b', 'c', 'd'], count = 250) {
  return letters.map(
    (letter, k): ScrollBandDto => ({
      startIndex: k * count,
      count,
      startToken: k === 0 ? null : `at-${k * count}`,
      letter,
    }),
  );
}

const VIEWPORT = 600;
const TRAVEL = VIEWPORT - SCROLLER_THUMB_HEIGHT;

function setup(overrides: Partial<FastScrollerProps> = {}) {
  const onJump = jest.fn();
  const props: FastScrollerProps = {
    unit: 'LETTER',
    bands: letterBands(),
    contentHeight: VIEWPORT * 10,
    viewportHeight: VIEWPORT,
    scrollOffset: 0,
    firstIndex: 0,
    onJump,
    ...overrides,
  };
  const view = render(
    <PaperProvider>
      <FastScroller {...props} />
    </PaperProvider>,
  );
  const rerender = (next: Partial<FastScrollerProps>) =>
    view.rerender(
      <PaperProvider>
        <FastScroller {...props} {...next} />
      </PaperProvider>,
    );
  return { ...view, onJump, rerender };
}

let clock = 1;

/** A one-finger responder event at page y [y], moved from [previous]. */
function touch(y: number, previous = y) {
  clock += 1;
  return {
    nativeEvent: { pageY: y, locationY: 0, touches: [{}], changedTouches: [] },
    touchHistory: {
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: clock,
      touchBank: [
        {
          touchActive: true,
          startPageX: 0,
          startPageY: previous,
          startTimeStamp: 0,
          currentPageX: 0,
          currentPageY: y,
          currentTimeStamp: clock,
          previousPageX: 0,
          previousPageY: previous,
          previousTimeStamp: clock - 1,
        },
      ],
    },
  };
}

/** Presses the thumb at its top and drags it down by [dy]; returns the release. */
function drag(dy: number) {
  const thumb = screen.getByTestId('files.scroller.thumb');
  fireEvent(thumb, 'responderGrant', touch(100));
  fireEvent(thumb, 'responderMove', touch(100 + dy, 100));
  return () => fireEvent(thumb, 'responderRelease', touch(100 + dy));
}

function opacityOf(testID: string): unknown {
  const style = screen.getByTestId(testID).props.style;
  const flat = Array.isArray(style)
    ? Object.assign({}, ...style.flat())
    : style;
  return flat.opacity;
}

describe('FastScroller', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('is absent when the content is at most three viewports tall', () => {
    setup({ contentHeight: VIEWPORT * 3 });

    expect(screen.queryByTestId('files.scroller.thumb')).toBeNull();
  });

  it('is absent without bands', () => {
    setup({ bands: [] });

    expect(screen.queryByTestId('files.scroller.thumb')).toBeNull();
  });

  it('shows while scrolling and fades out 1.5 s after scrolling stops', () => {
    const { rerender } = setup();
    expect(opacityOf('files.scroller')).toBe(0);

    rerender({ scrollOffset: 300 });
    expect(opacityOf('files.scroller')).toBe(1);

    act(() => jest.advanceTimersByTime(SCROLLER_FADE_DELAY_MS - 100));
    rerender({ scrollOffset: 400 });
    act(() => jest.advanceTimersByTime(SCROLLER_FADE_DELAY_MS - 100));
    expect(opacityOf('files.scroller')).toBe(1);

    act(() => jest.advanceTimersByTime(1000));
    expect(opacityOf('files.scroller')).toBe(0);
    expect(SCROLLER_FADE_DELAY_MS).toBe(1500);
  });

  it('maps the dragged thumb to a band, shows its label and jumps there on release', () => {
    const { onJump } = setup();

    const release = drag(0.8 * TRAVEL);

    expect(screen.getByTestId('files.scroller.label')).toHaveTextContent('D');
    expect(opacityOf('files.scroller')).toBe(1);
    expect(onJump).not.toHaveBeenCalled();

    act(() => {
      fireEvent(
        screen.getByTestId('files.scroller.thumb'),
        'responderMove',
        touch(100 + 0.3 * TRAVEL, 100 + 0.8 * TRAVEL),
      );
    });
    expect(screen.getByTestId('files.scroller.label')).toHaveTextContent('B');

    release();

    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith(250);
    // The reached band stays readable until the scroller fades out.
    expect(screen.getByTestId('files.scroller.label')).toHaveTextContent('B');
    act(() => jest.advanceTimersByTime(SCROLLER_FADE_DELAY_MS + 1000));
    expect(screen.queryByTestId('files.scroller.label')).toBeNull();
  });

  it('rests on the band it jumped to: a drag from there maps back to it', () => {
    const { onJump, rerender } = setup();
    drag(0.6 * TRAVEL)();
    expect(onJump).toHaveBeenLastCalledWith(500);

    // The list scrolled to file 500, the first of band c.
    rerender({ scrollOffset: 3000, firstIndex: 500 });
    const thumb = screen.getByTestId('files.scroller.thumb');
    expect(thumb.props.accessibilityValue).toEqual({ text: 'C' });

    // A tiny drag from there stays in band c.
    drag(1)();
    expect(onJump).toHaveBeenLastCalledWith(500);
  });

  it('keeps the thumb inside the track', () => {
    const { onJump } = setup();

    drag(10 * TRAVEL)();
    expect(onJump).toHaveBeenLastCalledWith(750);

    drag(-10 * TRAVEL)();
    expect(onJump).toHaveBeenLastCalledWith(0);
  });

  it('labels date and size bands with bandLabel', () => {
    setup({
      unit: 'SIZE',
      bands: [
        { startIndex: 0, count: 10, startToken: null, lowerBytes: 3_000_000 },
        { startIndex: 10, count: 10, startToken: 't', lowerBytes: 3_200_000 },
      ],
    });

    drag(0.9 * TRAVEL);

    expect(screen.getByTestId('files.scroller.label')).toHaveTextContent(
      '3.2 MB',
    );
  });

  it('is an adjustable control whose value is the band and whose actions step through the bands (Story 2 sc. 7)', () => {
    const { onJump } = setup();
    const thumb = screen.getByTestId('files.scroller.thumb');

    expect(thumb.props.accessibilityRole).toBe('adjustable');
    expect(thumb.props.accessibilityLabel).toBe(scrollerLabel());
    expect(thumb.props.accessibilityValue).toEqual({ text: 'A' });
    expect(
      thumb.props.accessibilityActions.map((a: { name: string }) => a.name),
    ).toEqual(['increment', 'decrement']);

    fireEvent(thumb, 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    });
    expect(onJump).toHaveBeenLastCalledWith(250);
    expect(
      screen.getByTestId('files.scroller.thumb').props.accessibilityValue,
    ).toEqual({ text: 'B' });

    fireEvent(thumb, 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    });
    expect(onJump).toHaveBeenLastCalledWith(500);

    fireEvent(thumb, 'accessibilityAction', {
      nativeEvent: { actionName: 'decrement' },
    });
    fireEvent(thumb, 'accessibilityAction', {
      nativeEvent: { actionName: 'decrement' },
    });
    expect(onJump).toHaveBeenLastCalledWith(0);
    onJump.mockClear();

    fireEvent(thumb, 'accessibilityAction', {
      nativeEvent: { actionName: 'decrement' },
    });
    expect(onJump).not.toHaveBeenCalled();
  });

  it('follows the first visible file with its value and position', () => {
    const { rerender } = setup();

    // The first visible file is in band c of a…d.
    rerender({ scrollOffset: 4000, firstIndex: 600 });

    expect(
      screen.getByTestId('files.scroller.thumb').props.accessibilityValue,
    ).toEqual({ text: 'C' });
  });

  it('ends a drag at the reached position when a new result arrives', () => {
    const { onJump, rerender } = setup();
    const release = drag(0.8 * TRAVEL);

    rerender({ bands: letterBands(['x', 'y'], 500) });

    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith(500);
    expect(screen.getByTestId('files.scroller.label')).toHaveTextContent('Y');

    release();
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it('passes the a11y sweep', () => {
    const view = setup();

    a11ySweep(view);
  });
});
