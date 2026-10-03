import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { MD3DarkTheme, MD3LightTheme, PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { a11ySweep } from '../../test-utils/a11ySweep';
import { SelectionBar } from '../SelectionBar';
import { SelectionContext, type SelectionState } from '../SelectionProvider';
import type { SelectionSummary } from '../summary';

function selectionState(summary: Partial<SelectionSummary>): SelectionState {
  const full: SelectionSummary = {
    count: 0,
    knownBytes: 0,
    unknownSizeCount: 0,
    hiddenByFilterCount: 0,
    ...summary,
  };
  return {
    snapshotId: full.count > 0 ? 'snap-1' : null,
    items: new Map(),
    isSelecting: full.count > 0,
    summary: full,
    selectingAll: false,
    error: null,
    notice: null,
    isSelected: () => false,
    longPress: jest.fn(),
    toggle: jest.fn(),
    selectAll: jest.fn(),
    clear: jest.fn(),
    removeIds: jest.fn(),
    dismissNotice: jest.fn(),
    dismissError: jest.fn(),
  };
}

function renderBar(
  summary: Partial<SelectionSummary>,
  {
    onDelete,
    bottomInset = 0,
    theme = MD3LightTheme,
  }: {
    onDelete?: () => void;
    bottomInset?: number;
    theme?: typeof MD3LightTheme;
  } = {},
) {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 360, height: 640 },
        insets: { top: 0, left: 0, right: 0, bottom: bottomInset },
      }}
    >
      <PaperProvider theme={theme}>
        <SelectionContext.Provider value={selectionState(summary)}>
          <SelectionBar onDelete={onDelete} />
        </SelectionContext.Provider>
      </PaperProvider>
    </SafeAreaProvider>,
  );
}

describe('SelectionBar', () => {
  it('shows the count and the total size bottom-left, labelled for Maestro', () => {
    renderBar({ count: 2, knownBytes: 140 });

    const summary = screen.getByLabelText('Selection 2 selected, 140 B');
    expect(summary).toHaveTextContent('2 selected · 140 B');
    expect(screen.queryByLabelText(/^Selection details /)).toBeNull();
  });

  it('formats the total in decimal units', () => {
    renderBar({ count: 37, knownBytes: 1_200_000_000 });

    expect(
      screen.getByLabelText('Selection 37 selected, 1.2 GB'),
    ).toHaveTextContent('37 selected · 1.2 GB');
  });

  it('reports unknown sizes separately, never as zero silently', () => {
    renderBar({ count: 3, knownBytes: 0, unknownSizeCount: 3 });

    expect(
      screen.getByLabelText('Selection 3 selected, 0 B'),
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Selection details 3 of unknown size'),
    ).toHaveTextContent('3 of unknown size');
  });

  it('says how many selected files the filter hides', () => {
    renderBar({ count: 5, knownBytes: 350, hiddenByFilterCount: 2 });

    expect(
      screen.getByLabelText('Selection details 2 hidden by filter'),
    ).toHaveTextContent('2 hidden by filter');
  });

  it('joins both details on the second line', () => {
    renderBar({
      count: 5,
      knownBytes: 350,
      unknownSizeCount: 1,
      hiddenByFilterCount: 2,
    });

    expect(
      screen.getByLabelText(
        'Selection details 1 of unknown size, 2 hidden by filter',
      ),
    ).toBeOnTheScreen();
  });

  it('shows Delete only when given onDelete', () => {
    const onDelete = jest.fn();
    const { rerender } = renderBar({ count: 1, knownBytes: 70 });
    expect(screen.queryByLabelText('Delete selected')).toBeNull();

    rerender(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 360, height: 640 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        <PaperProvider>
          <SelectionContext.Provider
            value={selectionState({ count: 1, knownBytes: 70 })}
          >
            <SelectionBar onDelete={onDelete} />
          </SelectionContext.Provider>
        </PaperProvider>
      </SafeAreaProvider>,
    );
    fireEvent.press(screen.getByLabelText('Delete selected'));

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while nothing is selected', () => {
    renderBar({ count: 0 });

    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(screen.queryByLabelText(/^Selection /)).toBeNull();
  });

  it('pads the bottom safe-area inset', () => {
    renderBar({ count: 1, knownBytes: 70 }, { bottomInset: 24 });

    const style = StyleSheet.flatten(
      screen.getByTestId('selection-bar').props.style,
    );
    expect(style.paddingBottom).toBeGreaterThanOrEqual(24);
  });

  it('takes its colours from the theme', () => {
    renderBar({ count: 1, knownBytes: 70 }, { theme: MD3DarkTheme });

    const style = StyleSheet.flatten(
      screen.getByTestId('selection-bar').props.style,
    );
    expect(style.backgroundColor).toBe(MD3DarkTheme.colors.elevation.level2);
  });

  it('passes the a11y sweep', () => {
    const result = renderBar(
      { count: 2, knownBytes: 140, hiddenByFilterCount: 1 },
      { onDelete: jest.fn() },
    );

    expect(() => a11ySweep(result)).not.toThrow();
  });
});
