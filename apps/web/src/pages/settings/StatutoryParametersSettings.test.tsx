import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateStatutoryParameterRequest, StatutoryParameterResponse } from "@pako/shared";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { StatutoryParametersSettings } from "@/pages/settings/StatutoryParametersSettings";

const firmId = "22222222-2222-2222-2222-222222222222";

let rows: StatutoryParameterResponse[] = [];

const listMock = vi.fn(async () => rows);
const createMock = vi.fn(async (_firmId: string, body: CreateStatutoryParameterRequest) => {
  const created: StatutoryParameterResponse = {
    id: "new-row",
    key: body.key,
    effectiveFrom: body.effectiveFrom,
    value: body.value,
    isOverride: true,
    needsVerification: false,
    source: body.source,
  };
  rows = [...rows, created];
  return created;
});

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      listStatutoryParameters: () => listMock(),
      createStatutoryParameter: (id: string, body: CreateStatutoryParameterRequest) => createMock(id, body),
      deleteStatutoryParameter: vi.fn(),
    },
  };
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <StatutoryParametersSettings firmId={firmId} />
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("StatutoryParametersSettings", () => {
  beforeEach(() => {
    rows = [
      {
        id: undefined,
        key: "PensionEmployeeRate",
        effectiveFrom: "2020-01-01",
        value: 0.05,
        isOverride: false,
        needsVerification: false,
        source: undefined,
      },
      {
        id: undefined,
        key: "MinimumWage",
        effectiveFrom: "2023-01-01",
        value: 350,
        isOverride: false,
        needsVerification: true,
        source: undefined,
      },
    ];
    createMock.mockClear();
  });

  it("shows defaults with rates as percentages and flags values to verify", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("5%")).toBeInTheDocument());
    expect(screen.getByText("350")).toBeInTheDocument();
    expect(screen.getByText("To verify")).toBeInTheDocument();
  });

  it("sends a typed percentage as a fraction", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("5%")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Parameter"), { target: { value: "PensionEmployerRate" } });
    fireEvent.change(screen.getByLabelText("Effective from"), { target: { value: "2027-01-01" } });
    fireEvent.change(screen.getByLabelText("Value (%)"), { target: { value: "6" } });
    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "Law 05/L-xxx" } });
    fireEvent.click(screen.getByRole("button", { name: "Add value" }));

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(firmId, {
        key: "PensionEmployerRate",
        effectiveFrom: "2027-01-01",
        value: 0.06,
        source: "Law 05/L-xxx",
      }),
    );
  });

  it("refuses to submit without a date", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("5%")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "400" } });
    fireEvent.click(screen.getByRole("button", { name: "Add value" }));
    expect(screen.getByText("Choose a parameter, an effective date and a numeric value.")).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });
});
