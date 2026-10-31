import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AccountMenu } from "@/components/layout/AccountMenu";
import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";

function renderMenu() {
  const onChangeCompany = vi.fn();
  const onLogout = vi.fn();
  render(
    <IntlProviderWrapper>
      <AccountMenu email="me@co.test" companyName="Pako Demo Sh.p.k." onChangeCompany={onChangeCompany} onLogout={onLogout} />
    </IntlProviderWrapper>,
  );
  return { onChangeCompany, onLogout };
}

describe("Log out menu", () => {
  it("opens from Log out and offers changing company or logging out", () => {
    const { onChangeCompany, onLogout } = renderMenu();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Log out/ }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("me@co.test")).toBeInTheDocument();
    expect(screen.getByText("Pako Demo Sh.p.k.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: /Change company/ }));
    expect(onChangeCompany).toHaveBeenCalled();
    expect(onLogout).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Log out/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Log out of PAKO" }));
    expect(onLogout).toHaveBeenCalled();
  });
});
