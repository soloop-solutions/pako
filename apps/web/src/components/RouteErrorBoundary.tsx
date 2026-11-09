import { Component, type ErrorInfo, type ReactNode } from "react";
import { en, sq } from "@/i18n/messages";

function t(key: string): string {
  const lang = localStorage.getItem("pako.language");
  const msgs = lang === "sq" ? sq : en;
  return msgs[key] ?? key;
}

type Props = { children: ReactNode };
type State = { hasError: boolean };

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[RouteErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex flex-col items-center justify-center gap-4 p-12 text-center">
        <h2 className="text-lg font-semibold">{t("errors.errorBoundary.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("errors.errorBoundary.description")}</p>
        <button
          type="button"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          onClick={() => {
            this.setState({ hasError: false });
            window.location.reload();
          }}
        >
          {t("errors.errorBoundary.reload")}
        </button>
      </div>
    );
  }
}
