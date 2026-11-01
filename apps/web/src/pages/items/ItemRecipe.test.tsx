import { ApiException } from "@pako/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { ItemRecipePanel } from "@/pages/items/ItemRecipe";

// docs/POS_PLAN.md §6.2 / P3: the item editor's Recipe tab against a mocked generated client.
const api = vi.hoisted(() => ({
  getItemRecipe: vi.fn(),
  saveItemRecipe: vi.fn(),
  itemsGET: vi.fn(),
  itemsGET2: vi.fn(),
}));

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      ...Object.fromEntries(Object.keys(api).map((k) => [k, (...args: unknown[]) => api[k as keyof typeof api](...args)])),
    },
  };
});

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: "c1" }),
}));

vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ access: null, isLoading: false, isStaff: false, canSee: () => true, canWrite: () => true, canApprove: () => true }),
}));

const item = (id: string, code: number, name: string, unit: string) => ({
  id, code, name, unit, description: undefined, type: 0, defaultTaxDefinitionId: undefined, defaultRevenueAccountId: undefined,
  defaultExpenseAccountId: undefined, defaultInventoryAccountId: undefined, defaultUnitPrice: undefined, barcodes: [],
});
const CHEESE = item("i2", 2, "Djathë", "kg");
const FLOUR = item("i4", 4, "Miell", "kg");

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <ItemRecipePanel itemId="i9" />
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("Item recipe (P3)", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.getItemRecipe.mockResolvedValue([{ ingredientItemId: "i2", ingredientName: "Djathë", unit: "kg", quantity: 0.05, wastePercent: 0, sortOrder: 0 }]);
    api.itemsGET.mockResolvedValue({ items: [CHEESE, FLOUR], total: 2 });
    api.itemsGET2.mockImplementation((_c: string, id: string) => Promise.resolve([CHEESE, FLOUR].find((i) => i.id === id)));
  });

  it("saves the ingredient lines with quantity and waste", async () => {
    api.saveItemRecipe.mockImplementation((_c: string, _i: string, body: { lines: { ingredientItemId: string; quantity: number; wastePercent: number }[] }) =>
      Promise.resolve(body.lines.map((l, i) => ({ ...l, ingredientName: "", unit: "kg", sortOrder: i }))));
    renderPanel();
    expect(await screen.findByDisplayValue("0.05")).toBeInTheDocument();
    // The quantity is labelled with the ingredient's own unit.
    expect(await screen.findByLabelText("Quantity (kg)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add ingredient" }));
    fireEvent.click(screen.getAllByRole("combobox", { name: "Ingredient" })[1]);
    fireEvent.mouseDown(await screen.findByRole("option", { name: "4 · Miell" }));
    await waitFor(() => expect(screen.getAllByLabelText("Quantity (kg)")).toHaveLength(2));
    fireEvent.change(screen.getAllByLabelText("Quantity (kg)")[1], { target: { value: "0.2" } });
    fireEvent.change(screen.getAllByLabelText("Waste %")[1], { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));

    await waitFor(() =>
      expect(api.saveItemRecipe).toHaveBeenCalledWith("c1", "i9", {
        lines: [
          { ingredientItemId: "i2", quantity: 0.05, wastePercent: 0 },
          { ingredientItemId: "i4", quantity: 0.2, wastePercent: 5 },
        ],
      }),
    );
    expect(await screen.findByText("Recipe saved.")).toBeInTheDocument();
  });

  it("shows the server's refusal of a recipe loop", async () => {
    api.saveItemRecipe.mockRejectedValue(new ApiException("Bad Request", 400, JSON.stringify("Djathë already contains this item in its own recipe."), {}, null));
    renderPanel();
    fireEvent.change(await screen.findByDisplayValue("0.05"), { target: { value: "0.06" } });
    fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
    expect(await screen.findByText("Djathë already contains this item in its own recipe.")).toBeInTheDocument();
  });
});
