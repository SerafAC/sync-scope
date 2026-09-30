import React from 'react';
import {ScrollView, StyleSheet} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {SourcesSection} from '../sources/SourcesSection';

/**
 * Settings tab. Hosts the "Folders" section; the repository section arrives
 * with a later feature and slots in here (research R14).
 */
export function SettingsScreen(): React.JSX.Element {
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
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
