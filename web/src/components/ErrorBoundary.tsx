import React from "react";

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
    console.error("Unhandled UI error", error);
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <main className="loading-view">
          <p className="error-text centered">Something went wrong: {this.state.error.message}</p>
        </main>
      );
    }
    return this.props.children;
  }
}
