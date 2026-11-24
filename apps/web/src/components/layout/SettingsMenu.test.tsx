import { fireEvent, render, screen } from "@testing-library/react";
import { Building, Settings, ShieldCheck } from "lucide-react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it } from "vitest";

import { SettingsMenu } from "@/components/layout/SettingsMenu";
import type { NavItem } from "@/config/nav";
import { ThemeProvider } from "@/context/ThemeContext";
import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";

const item = (titleKey: string, path: string, icon: NavItem["icon"]) => ({ titleKey, path, icon, descriptionKey: titleKey }) as NavItem;

beforeAll(() => {
  window.matchMedia ??= ((query: string) =>
    ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }) as unknown as MediaQueryList);
});

// User request 2026-11-24: language, light/dark and the configuration pages in one sidebar menu.
describe("SettingsMenu", () => {
  it("offers language, appearance and the settings and administration pages", () => {
    render(
      <MemoryRouter>
        <IntlProviderWrapper>
          <ThemeProvider>
            <SettingsMenu
              activePath="/invoicing"
              sections={[
                { items: [item("nav.settings", "/settings", Settings), item("nav.companyProfile", "/company-profile", Building)] },
                { labelKey: "sidebar.category.administration", items: [item("nav.usersAndRoles", "/admin/users", ShieldCheck)] },
              ]}
            />
          </ThemeProvider>
        </IntlProviderWrapper>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Settings and configuration" }));
    expect(screen.getByRole("radiogroup", { name: "Language" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("link", { name: "Company Profile" })).toHaveAttribute("href", "/company-profile");
    expect(screen.getByText("Administration")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Users/ })).toHaveAttribute("href", "/admin/users");

    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
  });
});
