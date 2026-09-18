import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react-native';

import App from '../App';

describe('SyncScope application shell', () => {
  it('shows the branded Material shell and all navigation placeholders', () => {
    render(<App />);

    expect(screen.getByText('SyncScope')).toBeOnTheScreen();
    expect(screen.getByRole('header', {name: 'Files'})).toBeOnTheScreen();
    expect(screen.getByText('Scan')).toBeOnTheScreen();
    expect(screen.getByText('Settings')).toBeOnTheScreen();
  });

  it('navigates between placeholder destinations', () => {
    render(<App />);

    fireEvent.press(screen.getByText('Scan'));
    expect(
      screen.getByText('Scan controls and progress will appear here after setup.'),
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByText('Settings'));
    expect(
      screen.getByText('Repository and folder settings will appear here.'),
    ).toBeOnTheScreen();
  });
});
