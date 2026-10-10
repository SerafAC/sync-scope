import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RepositorySection } from '../repository/RepositorySection';
import { SourcesSection } from '../sources/SourcesSection';

/**
 * Settings tab. Hosts the "Repository" section (the saved server and the way
 * into the Repository form) above the "Device folders" section (research R14).
 */
export function SettingsScreen(): React.JSX.Element {
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <RepositorySection />
        <SourcesSection />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 24,
    padding: 24,
  },
  safeArea: {
    flex: 1,
  },
});
