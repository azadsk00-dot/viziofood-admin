// Error boundary — a crash in one screen must never take the terminal down.
// Shows a clear recovery action instead of a white screen.

import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { colors, radius, spacing, type as typeScale } from '../theme';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // Technical details stay in logs; the UI shows a friendly message.
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
        <Text style={styles.title}>The app hit an unexpected problem</Text>
        <Text style={styles.body}>
          Your orders are safe — they live in the VIZIO FOOD backend. Restart
          the screen to continue.
        </Text>
        <Text style={styles.detail}>{this.state.error.message}</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => this.setState({ error: null })}
          accessibilityRole="button"
          accessibilityLabel="Try again"
        >
          <Text style={styles.buttonLabel}>TRY AGAIN</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xxl, gap: spacing.lg },
  title: { color: colors.text, fontSize: typeScale.heading, fontWeight: '900' },
  body: { color: colors.textMuted, fontSize: typeScale.body },
  detail: { color: colors.textFaint, fontSize: typeScale.small },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    alignSelf: 'flex-start',
  },
  buttonLabel: { color: '#06251A', fontWeight: '800', fontSize: typeScale.bodyLarge },
});
