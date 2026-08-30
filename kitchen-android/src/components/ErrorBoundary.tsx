// ErrorBoundary — the kitchen app must NEVER crash to the launcher. Any
// render error is caught here, logged as an incident, and replaced with a
// RELOAD button so service continues after a tap. Root causes are still
// fixed properly (see git history) — this is the last line of defence.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { dark } from '../theme';

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

  componentDidCatch(error: Error): void {
    console.error('[error-boundary]', error.message);
  }

  render(): React.ReactElement {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message} numberOfLines={4}>
            {this.state.error.message}
          </Text>
          <Pressable style={styles.button} onPress={() => this.setState({ error: null })}>
            <Text style={styles.buttonText}>CONTINUE</Text>
          </Pressable>
        </View>
      );
    }
    return <>{this.props.children}</>;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: dark.background, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: dark.danger, fontSize: 22, fontWeight: '900', marginBottom: 8 },
  message: { color: dark.textDim, fontSize: 14, textAlign: 'center', marginBottom: 20 },
  button: { backgroundColor: dark.accent, borderRadius: 12, paddingHorizontal: 28, paddingVertical: 14 },
  buttonText: { color: dark.accentText, fontWeight: '900', fontSize: 16 },
});

export default ErrorBoundary;
