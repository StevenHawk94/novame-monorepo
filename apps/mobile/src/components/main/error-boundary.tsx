import { Component, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

/**
 * Global render-error boundary (white-screen guard).
 *
 * React error boundaries must be class components — getDerivedStateFromError /
 * componentDidCatch have no Hook equivalent. Catches render / lifecycle /
 * constructor errors anywhere in the wrapped tree and shows a branded
 * fallback instead of a blank white screen. Does NOT catch errors in event
 * handlers or async code (those don't crash the render tree).
 *
 * Reload (A+): reset the boundary AND router.replace('/') back to the startup
 * route, so a deterministic crash on the current screen lands the user on a
 * freshly re-dispatched route instead of re-crashing in place. A
 * consecutive-crash counter (>=3) switches the message to "fully close and
 * reopen" and hides Reload, preventing an infinite Reload->crash flicker.
 * It cannot fix deterministic code bugs — those require a code fix + release;
 * its job is to replace a blank screen with a usable exit.
 */
type Props = { children: ReactNode };
type State = { hasError: boolean; crashCount: number };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, crashCount: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('[ErrorBoundary] caught render error:', error?.message ?? error);
    this.setState((s) => ({ crashCount: s.crashCount + 1 }));
  }

  handleReload = () => {
    this.setState({ hasError: false });
    try {
      router.replace('/');
    } catch {
      // router not ready (extremely early crash): state reset alone still
      // re-renders the subtree.
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const persistent = this.state.crashCount >= 3;
    return (
      <View style={styles.root}>
        <View style={styles.body}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>
            {persistent
              ? 'Burrow keeps running into a problem. Please fully close the app and open it again.'
              : 'Burrow hit an unexpected error. Tap reload to try again.'}
          </Text>
          {!persistent ? (
            <Pressable
              onPress={this.handleReload}
              style={({ pressed }) => [styles.button, { opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={styles.buttonText}>Reload</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#4C331B',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  body: { width: '100%', maxWidth: 360, alignItems: 'center' },
  title: {
    color: '#FFFFFF',
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    marginBottom: 14,
    textAlign: 'center',
  },
  message: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
    marginBottom: 32,
  },
  button: {
    width: '100%',
    backgroundColor: '#4A3423',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonText: { color: '#FFFFFF', fontSize: 17, fontFamily: 'Inter_700Bold' },
});
