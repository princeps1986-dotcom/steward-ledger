import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** 오류 화면에서 [다시 시도]를 누를 때 호출(보통 해당 화면을 다시 그립니다) */
  onReset?(): void;
}

interface State {
  error: Error | null;
}

/**
 * 화면을 그리다 예외가 나면 앱 전체가 하얗게 멈추는 대신 이 안내를 보여 줍니다.
 * 저장된 데이터는 화면 오류와 무관하므로 그대로입니다. 메뉴는 계속 쓸 수 있습니다.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('화면 오류', error, info.componentStack);
  }

  private retry = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto mt-10 max-w-xl space-y-3 rounded-lg border border-red-300 bg-red-50 p-5 text-red-800">
        <h2 className="text-base font-bold">이 화면을 표시하는 중 오류가 발생했습니다</h2>
        <p className="text-sm leading-relaxed">저장된 데이터는 그대로 안전합니다. [다시 시도]를 누르거나 다른 메뉴로 이동해 보세요. 계속 같은 오류가 나면 아래 내용을 알려 주세요.</p>
        <p className="break-all rounded bg-white px-2 py-1 text-xs text-gray-700">{this.state.error.message}</p>
        <div className="flex gap-2">
          <button className="btn" onClick={this.retry}>
            다시 시도
          </button>
          <button className="btn" onClick={() => window.location.reload()}>
            앱 새로고침
          </button>
        </div>
      </div>
    );
  }
}
