import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[vizio] unhandled render error', error, info);
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="center-page">
          <p className="vz-eyebrow">Something went wrong</p>
          <h1>We’ll be back shortly.</h1>
          <p className="vz-muted">The error was logged. Your order and account are safe — nothing is lost.</p>
          <button className="vz-btn vz-btn--primary" onClick={() => this.setState({ failed: false })}>
            Try again
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
