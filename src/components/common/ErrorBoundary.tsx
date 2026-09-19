import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Страховка от «белого экрана»: если React-дерево падает, пользователь видит
 * понятный текст и кнопку перезагрузки, а данные в IndexedDB остаются на месте.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[nocturne] непойманная ошибка интерфейса", error, info);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    const { error } = this.state;

    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-6 text-content">
        <div className="w-full max-w-md rounded-3xl border border-white/[0.08] bg-surface p-6 shadow-xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-danger">
            Сбой интерфейса
          </p>
          <h1 className="mt-2 text-lg font-semibold">Что-то пошло не так</h1>
          <p className="mt-2 text-sm leading-relaxed text-content-secondary">
            Экран не смог отрисоваться. Все истории, персонажи и настройки
            сохранены в этом браузере — перезагрузка ничего не потеряет.
          </p>

          <pre className="mt-4 max-h-40 overflow-auto rounded-2xl border border-white/[0.06] bg-surface-2 p-3 text-[11px] leading-relaxed text-content-secondary [overflow-wrap:anywhere] whitespace-pre-wrap">
            {error.message || String(error)}
          </pre>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:opacity-90"
            >
              Перезагрузить
            </button>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="rounded-xl border border-white/[0.08] px-4 py-2 text-sm font-semibold text-content-secondary hover:bg-surface-2"
            >
              Попробовать снова
            </button>
          </div>
        </div>
      </div>
    );
  }
}
