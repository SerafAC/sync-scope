import React from 'react';
import {StyleSheet} from 'react-native';
import {Surface, Text} from 'react-native-paper';
import {SafeAreaView} from 'react-native-safe-area-context';

type PlaceholderScreenProps = {
  description: string;
  title: string;
};

export function PlaceholderScreen({
  description,
  title,
}: PlaceholderScreenProps): React.JSX.Element {
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
      <Surface accessibilityRole="summary" elevation={1} style={styles.card}>
        <Text accessibilityRole="header" variant="headlineMedium">
          {title}
        </Text>
        <Text variant="bodyLarge">{description}</Text>
      </Surface>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    gap: 12,
    margin: 24,
    padding: 24,
  },
  safeArea: {
    flex: 1,
  },
});
