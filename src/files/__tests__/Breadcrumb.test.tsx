import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import { a11ySweep } from '../../test-utils/a11ySweep';
import { Breadcrumb } from '../Breadcrumb';
import type { Crumb } from '../useListNavigation';

const CRUMBS: Crumb[] = [
  { name: 'All folders', index: -1 },
  { name: 'Gallery', index: 0 },
  { name: 'album', index: 1 },
];

function renderCrumbs(crumbs: Crumb[], goTo = jest.fn()) {
  const result = render(
    <PaperProvider>
      <Breadcrumb crumbs={crumbs} goTo={goTo} />
    </PaperProvider>,
  );
  return { ...result, goTo };
}

describe('Breadcrumb', () => {
  it('shows every crumb in order with exact labels', () => {
    renderCrumbs(CRUMBS);

    expect(screen.getByText('All folders')).toBeOnTheScreen();
    expect(screen.getByText('Gallery')).toBeOnTheScreen();
    expect(screen.getByText('album')).toBeOnTheScreen();
    expect(screen.getByLabelText('Breadcrumb All folders')).toBeOnTheScreen();
    expect(screen.getByLabelText('Breadcrumb Gallery')).toBeOnTheScreen();
    expect(screen.getByLabelText('Breadcrumb album')).toBeOnTheScreen();
  });

  it('goes to the pressed crumb by its index', () => {
    const { goTo } = renderCrumbs(CRUMBS);

    fireEvent.press(screen.getByLabelText('Breadcrumb Gallery'));
    expect(goTo).toHaveBeenLastCalledWith(0);

    fireEvent.press(screen.getByLabelText('Breadcrumb All folders'));
    expect(goTo).toHaveBeenLastCalledWith(-1);
  });

  it('disables the last crumb', () => {
    const { goTo } = renderCrumbs(CRUMBS);

    expect(screen.getByLabelText('Breadcrumb album')).toBeDisabled();
    expect(screen.getByLabelText('Breadcrumb Gallery')).toBeEnabled();
    fireEvent.press(screen.getByLabelText('Breadcrumb album'));
    expect(goTo).not.toHaveBeenCalled();
  });

  it('passes the a11y sweep', () => {
    expect(() => a11ySweep(renderCrumbs(CRUMBS))).not.toThrow();
  });
});
