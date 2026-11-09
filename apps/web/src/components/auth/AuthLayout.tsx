import { useContext, type ReactNode } from "react";
import { BookCheck, Building2, FileCheck2, Layers } from "lucide-react";
import { useIntl } from "react-intl";

import { AccountingIllustration } from "@/components/auth/AccountingIllustration";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggleButton } from "@/components/layout/ThemeToggleButton";
import { ThemeContext } from "@/context/theme-context";
import { cn } from "@/lib/utils";

const points = [
  { icon: FileCheck2, id: "auth.brand.sef" },
  { icon: BookCheck, id: "auth.brand.ledger" },
  { icon: Building2, id: "auth.brand.firms" },
  { icon: Layers, id: "auth.brand.modules" },
] as const;

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="currentColor" fillOpacity="0.16" />
      <path d="M7 17V7h5.5a3.5 3.5 0 1 1 0 7H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type AuthLayoutProps = {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  wide?: boolean;
};

export function AuthLayout({ title, description, children, wide }: AuthLayoutProps) {
  const intl = useIntl();
  const hasTheme = useContext(ThemeContext) !== null;
  const t = (id: string) => intl.formatMessage({ id });

  return (
    <div className="grid min-h-[100dvh] bg-background lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="auth-panel relative isolate flex flex-col justify-between gap-6 overflow-hidden px-6 py-5 text-[var(--auth-panel-foreground)] lg:px-12 lg:py-10">
        <div className="flex items-center gap-2.5">
          <BrandMark className="size-9 text-[var(--auth-panel-foreground)]" />
          <span className="text-lg font-semibold tracking-tight">PAKO</span>
        </div>

        <div className="hidden flex-1 flex-col justify-center gap-8 lg:flex">
          {/* Illustration — the visual anchor that makes the panel feel professional */}
          <AccountingIllustration className="mx-auto w-full max-w-[360px] opacity-90" />

          <div className="flex flex-col gap-3">
            <h2 className="text-balance text-3xl leading-tight font-semibold tracking-tight">{t("auth.brand.headline")}</h2>
            <p className="max-w-[44ch] text-[15px] leading-relaxed text-[var(--auth-panel-muted)]">{t("auth.brand.sub")}</p>
          </div>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-4">
            {points.map(({ icon: Icon, id }) => (
              <li key={id} className="flex items-start gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/10">
                  <Icon className="size-4" />
                </span>
                <span className="text-sm leading-relaxed text-[var(--auth-panel-muted)]">
                  <span className="block font-medium text-[var(--auth-panel-foreground)]">{t(`${id}.title`)}</span>
                  {t(`${id}.body`)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="hidden text-xs text-[var(--auth-panel-muted)] lg:block">{t("auth.brand.footer")}</p>
      </aside>

      <main className="flex flex-col">
        <div className="flex items-center justify-end gap-2 px-6 pt-5">
          {hasTheme && <ThemeToggleButton />}
          <LanguageSwitcher />
        </div>
        <div className="flex flex-1 items-center justify-center px-6 py-10">
          <div className={cn("w-full", wide ? "max-w-lg" : "max-w-sm")}>
            <div className="mb-6 flex flex-col gap-1.5">
              {/* Show brand mark on mobile where the aside panel is hidden */}
              <div className="mb-4 flex items-center gap-2.5 lg:hidden">
                <BrandMark className="size-8 text-primary" />
                <span className="text-lg font-semibold tracking-tight text-foreground">PAKO</span>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
              {description && <p className="text-sm text-muted-foreground">{description}</p>}
            </div>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
