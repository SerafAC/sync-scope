import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Menu } from 'react-native-paper';

export interface ChoiceOption<T extends string> {
  value: T;
  /** The option's text in the open menu; also its accessibility label. */
  text: string;
}

export interface ChoiceMenuProps<T extends string> {
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange: (value: T) => void;
  /** The button's text: the current choice. */
  buttonText: string;
  /** The button's accessibility label, for example `Sort: Name, A to Z` (FR-017). */
  buttonLabel: string;
  icon: string;
  testID: string;
}

/**
 * A drop-down (research R10): an outlined button showing the current choice
 * that opens a Paper `Menu` of the options, with the current one marked by a
 * check and its selected state. Picking an option closes the menu; picking
 * the current one changes nothing.
 *
 * Layout (feature 009 R10, FR-006): the `control` wrapper takes half the
 * toolbar row and Paper's anchor wrapper stretches to it, so the button's
 * `width: '100%'` fills the half (measured on the device by the staged hook
 * assert-equal-halves.sh). Paper's `Menu` `style` styles the open menu, not
 * the anchor, so it is left unset. Paper draws the label on one line; `label`
 * lets it shrink, so a long choice truncates inside its half instead of
 * overflowing the button.
 */
export function ChoiceMenu<T extends string>({
  value,
  options,
  onChange,
  buttonText,
  buttonLabel,
  icon,
  testID,
}: ChoiceMenuProps<T>): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);

  return (
    <View style={styles.control} testID={`${testID}-control`}>
      <Menu
        anchor={
          <Button
            accessibilityLabel={buttonLabel}
            compact
            icon={icon}
            labelStyle={styles.label}
            mode="outlined"
            onPress={show}
            style={styles.button}
            testID={testID}
          >
            {buttonText}
          </Button>
        }
        anchorPosition="bottom"
        onDismiss={hide}
        testID={`${testID}-menu`}
        visible={open}
      >
        {options.map(option => {
          const current = option.value === value;
          return (
            <Menu.Item
              accessibilityLabel={option.text}
              accessibilityState={{ selected: current }}
              key={option.value}
              leadingIcon={current ? 'check' : undefined}
              onPress={() => {
                setOpen(false);
                if (!current) {
                  onChange(option.value);
                }
              }}
              testID={`${testID}-option-${option.value}`}
              title={option.text}
            />
          );
        })}
      </Menu>
    </View>
  );
}

const styles = StyleSheet.create({
  control: {
    flex: 1,
    minWidth: 0,
  },
  button: {
    width: '100%',
  },
  label: {
    flexShrink: 1,
  },
});
