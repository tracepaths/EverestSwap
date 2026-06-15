import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch() {
    console.error('[ErrorBoundary] A component error occurred');
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[var(--app-bg)] text-[var(--app-text)] flex items-center justify-center p-6">
          <div className="max-w-md text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-red-600/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-[var(--app-danger)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold">Terjadi Kesalahan</h2>
            <p className="text-sm text-[var(--app-muted)]">
              {this.state.error?.message || 'Unknown error'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2.5 bg-[var(--app-blue)] hover:bg-[var(--app-blue-2)] rounded-xl font-medium transition-colors"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
