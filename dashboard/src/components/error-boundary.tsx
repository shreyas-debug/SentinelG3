"use client";

import React, { Component, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

/**
 * Error Boundary component to catch and display React errors gracefully.
 * 
 * Usage:
 * ```tsx
 * <ErrorBoundary>
 *   <YourComponent />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });

    // Log to external service (e.g., Sentry) in production
    if (process.env.NODE_ENV === "production") {
      // logErrorToService(error, errorInfo);
    }
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg-primary)] p-6">
          <div className="max-w-2xl w-full rounded-xl border border-[var(--color-red)]/30 bg-[var(--color-bg-card)] shadow-2xl p-8">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-lg bg-[var(--color-red)]/10 shrink-0">
                <AlertTriangle className="h-8 w-8 text-[var(--color-red)]" />
              </div>
              <div className="flex-1">
                <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
                  Something Went Wrong
                </h1>
                <p className="text-[14px] text-[var(--color-text-secondary)] mb-4 leading-relaxed">
                  Sentinel-G3 encountered an unexpected error. This has been logged for investigation.
                </p>

                {/* Error details (dev mode only) */}
                {process.env.NODE_ENV === "development" && this.state.error && (
                  <details className="mb-4">
                    <summary className="cursor-pointer text-[13px] font-semibold text-[var(--color-amber)] mb-2 hover:underline">
                      Show Error Details
                    </summary>
                    <div className="bg-[var(--color-bg-terminal)] border border-[var(--color-border)] rounded-lg p-4 overflow-auto max-h-64">
                      <pre className="text-[11px] text-[var(--color-red)] font-mono whitespace-pre-wrap">
                        {this.state.error.toString()}
                        {this.state.errorInfo && (
                          <>
                            {"\n\n"}
                            {this.state.errorInfo.componentStack}
                          </>
                        )}
                      </pre>
                    </div>
                  </details>
                )}

                {/* Action buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={this.handleReset}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--color-emerald)] bg-[var(--color-emerald)]/10 text-[var(--color-emerald)] hover:bg-[var(--color-emerald)]/20 transition-colors font-semibold text-[13px]"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Try Again
                  </button>
                  <button
                    onClick={() => window.location.href = "/"}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] transition-colors font-semibold text-[13px]"
                  >
                    Go to Home
                  </button>
                </div>

                {/* Helpful tips */}
                <div className="mt-6 p-4 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">
                    Troubleshooting Tips
                  </p>
                  <ul className="text-[12px] text-[var(--color-text-secondary)] space-y-1 list-disc list-inside">
                    <li>Try refreshing the page</li>
                    <li>Check your internet connection</li>
                    <li>Clear browser cache and cookies</li>
                    <li>Restart the backend server if running locally</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Smaller error boundary for component-level errors
 */
export function ComponentErrorBoundary({ children, componentName }: { children: ReactNode; componentName?: string }) {
  return (
    <ErrorBoundary
      fallback={
        <div className="rounded-lg border border-[var(--color-red)]/30 bg-[var(--color-red)]/5 p-4 my-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-[var(--color-red)]" />
            <p className="text-[13px] font-semibold text-[var(--color-red)]">
              Error Loading {componentName || "Component"}
            </p>
          </div>
          <p className="text-[11px] text-[var(--color-text-muted)]">
            This component failed to render. Try refreshing the page.
          </p>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}
