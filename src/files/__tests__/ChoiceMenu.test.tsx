import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import { ChoiceMenu, type ChoiceOption } from '../ChoiceMenu';

type Choice = 'SHORT' | 'LONG';

const OPTIONS: readonly ChoiceOption<Choice>[] = [
  { value: 'SHORT', text: 'Short' },
  { value: 'LONG', text: 'A label far longer than half of any toolbar row' },
];

function renderMenu() {
  return render(
    <PaperProvider>
      <ChoiceMenu
        buttonLabel="Choice: long"
        buttonText="A label far longer than half of any toolbar row"
        icon="sort"
        onChange={jest.fn()}
        options={OPTIONS}
        testID="choice"
        value="LONG"
      />
    </PaperProvider>,
  );
}

/**
 * Feature 009, research R10 (FR-006): the drop-down fills its half of the
 * toolbar row. The T020 device spike (API 36, `uiautomator dump`) found no
 * box that shrinks to its content: Paper's anchor wrapper is stretched by the
 * `-control` column (its default `alignItems: 'stretch'`), and the button is
 * the wrapper's full width less its border. Paper's `Menu` `style` styles the
 * open menu, not the anchor wrapper, so it is no stretch hook and stays unset.
 * What the row still needs is a long label that truncates inside its half.
 */
describe('ChoiceMenu layout (009 R10)', () => {
  it('keeps 007’s half-row wrapper and full-width button', () => {
    renderMenu();

    expect(screen.getByTestId('choice-control')).toHaveStyle({
      flex: 1,
      minWidth: 0,
    });
    expect(screen.getByTestId('choice-container-outer-layer')).toHaveStyle({
      width: '100%',
    });
  });

  it('leaves the Menu style unset, so the open menu keeps its own width', () => {
    renderMenu();

    const menu = screen.UNSAFE_getByProps({ testID: 'choice-menu' });
    expect(menu.props.style).toBeUndefined();
  });

  it('truncates the label to one line that may shrink inside the button', () => {
    renderMenu();

    const label = screen.getByTestId('choice-text');
    expect(label).toHaveProp('numberOfLines', 1);
    expect(label).toHaveStyle({ flexShrink: 1 });
  });
});
