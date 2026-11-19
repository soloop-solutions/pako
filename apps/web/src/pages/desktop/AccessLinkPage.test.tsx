import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiException } from "@pako/shared";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { AccessLinkEntry } from "@/pages/desktop/AccessLinkEntry";
import { AccessLinkPage } from "@/pages/desktop/AccessLinkPage";

const api = vi.hoisted(() => ({ getDesktopSetup: vi.fn() }));

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, apiClient: { ...actual.apiClient, ...api } };
});

const bridge = {
  isDesktop: true,
  version: "1.0.0",
  backupNow: vi.fn(),
  listBackups: vi.fn(),
  restoreFromFile: vi.fn(),
  chooseBackupDir: vi.fn(),
  getBackupSettings: vi.fn(),
  openLogFolder: vi.fn(),
};

const token = "invite-".padEnd(43, "x");

function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.pathname + location.search}</div>;
}

function wrap(initial: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProviderWrapper>
        <MemoryRouter initialEntries={[initial]}>
          <Routes>
            <Route path="/use-link" element={<AccessLinkPage />} />
            <Route path="/login" element={<div><AccessLinkEntry /><Where /></div>} />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </IntlProviderWrapper>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.getDesktopSetup.mockReset();
  api.getDesktopSetup.mockResolvedValue({ needsSetup: false });
  (window as unknown as { pakoDesktop?: unknown }).pakoDesktop = bridge;
});

afterEach(() => {
  delete (window as unknown as { pakoDesktop?: unknown }).pakoDesktop;
});

function paste(value: string) {
  fireEvent.change(screen.getByLabelText(/Invitation or reset link/), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

describe("AccessLinkPage", () => {
  it("AccessLink_InvitationLink_OpensAcceptInvite", async () => {
    wrap("/use-link");
    paste(`http://127.0.0.1:6123/accept-invite?token=${token}`);
    expect(await screen.findByTestId("where")).toHaveTextContent(`/accept-invite?token=${token}`);
  });

  it("AccessLink_ResetLink_OpensResetPassword", async () => {
    wrap("/use-link");
    paste("http://127.0.0.1:6123/reset-password?email=ana%40firma.test&token=CfDJ8%2Babc");
    expect(await screen.findByTestId("where")).toHaveTextContent("/reset-password?email=ana%40firma.test&token=CfDJ8%2Babc");
  });

  it("AccessLink_BareToken_OpensAcceptInvite", async () => {
    wrap("/use-link");
    paste(token);
    expect(await screen.findByTestId("where")).toHaveTextContent(`/accept-invite?token=${token}`);
  });

  it("AccessLink_Garbage_ShowsAClearError_AndStays", async () => {
    wrap("/use-link");
    paste("hello there");
    expect(await screen.findByRole("alert")).toHaveTextContent(/not an invitation or password reset link/i);
    expect(screen.queryByTestId("where")).not.toBeInTheDocument();
  });

  it("AccessLink_Page_RedirectsToLogin_InTheBrowser", async () => {
    delete (window as unknown as { pakoDesktop?: unknown }).pakoDesktop;
    wrap("/use-link");
    expect(await screen.findByTestId("where")).toHaveTextContent("/login");
  });
});

describe("AccessLinkEntry", () => {
  it("AccessLinkEntry_ShownOnDesktopLogin_AndOpensThePage", async () => {
    wrap("/login");
    fireEvent.click(await screen.findByRole("link", { name: "I have an invitation or reset link" }));
    expect(await screen.findByLabelText(/Invitation or reset link/)).toBeInTheDocument();
  });

  it("AccessLinkEntry_HiddenWithoutBridge", async () => {
    delete (window as unknown as { pakoDesktop?: unknown }).pakoDesktop;
    wrap("/login");
    await screen.findByTestId("where");
    expect(screen.queryByText("I have an invitation or reset link")).not.toBeInTheDocument();
    expect(api.getDesktopSetup).not.toHaveBeenCalled();
  });

  it("AccessLinkEntry_HiddenWhenDesktopEndpointsAbsent", async () => {
    api.getDesktopSetup.mockRejectedValue(new ApiException("nf", 404, "", {}, null));
    wrap("/login");
    await screen.findByTestId("where");
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("I have an invitation or reset link")).not.toBeInTheDocument();
  });
});
