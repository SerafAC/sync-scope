import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import { a11ySweep } from '../../test-utils/a11ySweep';
import type { FilesView } from '../useFiles';
import { ViewMenu } from '../ViewMenu';

function Harness({
  initial,
  onChange,
}: {
  initial: FilesView;
  onChange: (view: FilesView) => void;
}): React.JSX.Element {
  const [view, setView] = useState(initial);
  return (
    <ViewMenu
      onChange={next => {
        onChange(next);
        setView(next);
      }}
      view={view}
    />
  );
}

function renderMenu(initial: FilesView = 'GALLERY') {
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
  return screen.UNSAFE_getByProps({ testID: 'files-view-menu' }).props.visible;
}

describe('ViewMenu', () => {
  it('shows the current view in its text and its accessibility label', () => {
    renderMenu('GALLERY');

    expect(screen.getByLabelText('View: Gallery')).toBeOnTheScreen();
    expect(screen.getByText('Gallery')).toBeOnTheScreen();
    expect(screen.queryByText('List')).toBeNull();
  });

  it('opens both views with the current one marked', () => {
    renderMenu('LIST');

    fireEvent.press(screen.getByLabelText('View: List'));

    expect(
      screen.getByLabelText('Gallery').props.accessibilityState?.selected,
    ).toBe(false);
    expect(
      screen.getByLabelText('List').props.accessibilityState?.selected,
    ).toBe(true);
  });

  it('picking a view reports it, closes the menu and relabels the button', () => {
    const { onChange } = renderMenu('GALLERY');

    fireEvent.press(screen.getByLabelText('View: Gallery'));
    fireEvent.press(screen.getByLabelText('List'));

    expect(onChange).toHaveBeenCalledWith('LIST');
    expect(screen.getByLabelText('View: List')).toBeOnTheScreen();
    expect(menuOpen()).toBe(false);
  });

  it('picking the current view changes nothing', () => {
    const { onChange } = renderMenu('GALLERY');

    fireEvent.press(screen.getByLabelText('View: Gallery'));
    fireEvent.press(screen.getByLabelText('Gallery'));

    expect(onChange).not.toHaveBeenCalled();
    expect(menuOpen()).toBe(false);
    expect(screen.getByLabelText('View: Gallery')).toBeOnTheScreen();
  });

  it('passes the a11y sweep, closed and open', () => {
    const result = renderMenu();
    a11ySweep(result);

    fireEvent.press(screen.getByLabelText('View: Gallery'));
    a11ySweep(result);
  });
});
