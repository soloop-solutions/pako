import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SubmitToAtkButton } from "@/components/SubmitToAtkButton";
import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";

const bridge = {
  isDesktop: true,
  version: "1.0.0",
  backupNow: () => undefined,
  listBackups: () => undefined,
  restoreFromFile: () => undefined,
  chooseBackupDir: () => undefined,
  getBackupSettings: () => undefined,
  openLogFolder: () => undefined,
};

afterEach(() => {
  delete (window as unknown as { pakoDesktop?: unknown }).pakoDesktop;
});

describe("SubmitToAtkButton", () => {
  it("SubmitToAtkButton_IsDisabled_AndExplains", () => {
    (window as unknown as { pakoDesktop?: unknown }).pakoDesktop = bridge;
    render(
      <IntlProviderWrapper>
        <SubmitToAtkButton />
      </IntlProviderWrapper>,
    );
    const button = screen.getByRole("button", { name: /Submit to ATK/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", expect.stringContaining("not available in the desktop app"));
    expect(screen.getByText(/not available in the desktop app/i, { selector: "span" })).toBeInTheDocument();
  });

  it("SubmitToAtkButton_RendersNothing_InHostedWeb", () => {
    const { container } = render(
      <IntlProviderWrapper>
        <SubmitToAtkButton />
      </IntlProviderWrapper>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
