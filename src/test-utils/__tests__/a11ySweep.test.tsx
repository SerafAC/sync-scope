import React from 'react';
import {Pressable, Text, View} from 'react-native';
import {render} from '@testing-library/react-native';
import {Chip, PaperProvider} from 'react-native-paper';

import {a11ySweep} from '../a11ySweep';

describe('a11ySweep', () => {
  it('fails on an unlabeled Pressable and names it by its text', () => {
    const result = render(
      <Pressable onPress={() => {}}>
        <Text>Open sunset</Text>
      </Pressable>,
    );

    expect(() => a11ySweep(result)).toThrow(/"Open sunset"/);
  });

  it('fails on an empty label', () => {
    const result = render(
      <Pressable accessibilityLabel="  " onPress={() => {}}>
        <Text>Blank</Text>
      </Pressable>,
    );

    expect(() => a11ySweep(result)).toThrow(/"Blank"/);
  });

  it('fails on an unlabeled element with an interactive role', () => {
    const result = render(
      <View accessibilityRole="tab">
        <Text>Gallery</Text>
      </View>,
    );

    expect(() => a11ySweep(result)).toThrow(/"Gallery"/);
  });

  it('passes on a labeled Pressable', () => {
    const result = render(
      <Pressable accessibilityLabel="sunset.png, Unsynced" onPress={() => {}}>
        <Text>sunset.png</Text>
      </Pressable>,
    );

    expect(() => a11ySweep(result)).not.toThrow();
  });

  it('passes on a labeled Paper control and fails on an unlabeled one', () => {
    const labeled = render(
      <PaperProvider>
        <Chip accessibilityLabel="Filter All, 6" onPress={() => {}}>
          All 6
        </Chip>
      </PaperProvider>,
    );
    expect(() => a11ySweep(labeled)).not.toThrow();

    const unlabeled = render(
      <PaperProvider>
        <Chip onPress={() => {}}>All 6</Chip>
      </PaperProvider>,
    );
    expect(() => a11ySweep(unlabeled)).toThrow(/All 6/);
  });

  it('ignores elements that are not interactive', () => {
    const result = render(
      <View>
        <Text>Just text</Text>
      </View>,
    );

    expect(() => a11ySweep(result)).not.toThrow();
  });
});
