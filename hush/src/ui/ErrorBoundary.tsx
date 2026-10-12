import { Component, type ReactNode } from 'react';
import { reportError } from '@/lib/errorReport';

/** Ловит падение части интерфейса: вместо чёрного экрана — запасной вариант */
export class ErrorBoundary extends Component<
  { where: string; fallback: ReactNode; onError?: () => void; resetKey?: unknown; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    reportError(error, this.props.where);
    this.props.onError?.();
  }

  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
