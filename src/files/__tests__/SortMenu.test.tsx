import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import type { FileSort } from '../../native/CloudSyncContracts';
import { a11ySweep } from '../../test-utils/a11ySweep';
import { SortMenu } from '../SortMenu';

function Harness({
  initial,
  onChange,
}: {
  initial: FileSort;
  onChange: (sort: FileSort) => void;
}): React.JSX.Element {
  const [sort, setSort] = useState(initial);
  return (
    <SortMenu
      onChange={next => {
        onChange(next);
        setSort(next);
      }}
      sort={sort}
    />
  );
}

function renderMenu(initial: FileSort = 'TIME_DESC') {
  const onChange = jest.fn();
  const result = render(
    <PaperProvider>
      <Harness initial={initial} onChange={onChange} />
    </PaperProvider>,
  );
  return { ...result, onChange };
}

/** Whether the Paper `Menu` is asked to be open (its close animation is not run in Jest). */
function menuOpen(): boolean {
  return screen.UNSAFE_getByProps({ testID: 'files-sort-menu' }).props.visible;
}

const OPTIONS = [
  'Name (A–Z)',
  'Name (Z–A)',
  'Date (newest first)',
  'Date (oldest first)',
  'Size (largest first)',
  'Size (smallest first)',
];

describe('SortMenu', () => {
  it('shows the current sort in its text and its accessibility label', () => {
    renderMenu('TIME_DESC');

    const button = screen.getByLabelText('Sort: Date, newest first');
    expect(button).toBeOnTheScreen();
    expect(screen.getByText('Date (newest first)')).toBeOnTheScreen();
    expect(screen.queryByText('Name (A–Z)')).toBeNull();
  });

  it('opens the six sorts in order with the current one marked', () => {
    renderMenu('SIZE_DESC');

    expect(menuOpen()).toBe(false);
    fireEvent.press(screen.getByLabelText('Sort: Size, largest first'));
    expect(menuOpen()).toBe(true);

    const items = OPTIONS.map(text => screen.getByLabelText(text));
    expect(items).toHaveLength(6);
    const order = screen
      .getAllByTestId(/^files-sort-option-[A-Z_]+$/)
      .map(node => node.props.testID);
    expect(order).toEqual([
      'files-sort-option-NAME_ASC',
      'files-sort-option-NAME_DESC',
      'files-sort-option-TIME_DESC',
      'files-sort-option-TIME_ASC',
      'files-sort-option-SIZE_DESC',
      'files-sort-option-SIZE_ASC',
    ]);
    const selected = OPTIONS.filter(
      text => screen.getByLabelText(text).props.accessibilityState?.selected,
    );
    expect(selected).toEqual(['Size (largest first)']);
  });

  it('picking a sort reports it, closes the menu and relabels the button', () => {
    const { onChange } = renderMenu('TIME_DESC');

    fireEvent.press(screen.getByLabelText('Sort: Date, newest first'));
    fireEvent.press(screen.getByLabelText('Size (smallest first)'));

    expect(onChange).toHaveBeenCalledWith('SIZE_ASC');
    expect(
      screen.getByLabelText('Sort: Size, smallest first'),
    ).toBeOnTheScreen();
    expect(menuOpen()).toBe(false);
  });

  it('picking the current sort closes the menu without a change', () => {
    const { onChange } = renderMenu('NAME_ASC');

    fireEvent.press(screen.getByLabelText('Sort: Name, A to Z'));
    fireEvent.press(screen.getByLabelText('Name (A–Z)'));

    expect(onChange).not.toHaveBeenCalled();
    expect(menuOpen()).toBe(false);
  });

  it('passes the a11y sweep, closed and open', () => {
    const result = renderMenu();
    a11ySweep(result);

    fireEvent.press(screen.getByLabelText('Sort: Date, newest first'));
    a11ySweep(result);
  });
});
