import { ApiException } from "@pako/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { MenuSetup } from "@/pages/pos/MenuSetup";
import { PosFloors } from "@/pages/pos/PosFloors";
import { PublicMenu } from "@/pages/pos/PublicMenu";

// docs/POS_PLAN.md §6.2 / P3: the restaurant back office and the public QR menu against a mocked
// generated client.
const api = vi.hoisted(() => ({
  listPosStores: vi.fn(),
  listPosFloors: vi.fn(),
  createPosFloor: vi.fn(),
  createPosTable: vi.fn(),
  updatePosTable: vi.fn(),
  renewPosTableQr: vi.fn(),
  listProductionCenters: vi.fn(),
  listModifierGroups: vi.fn(),
  createModifierGroup: vi.fn(),
  getPosMenu: vi.fn(),
  getCombo: vi.fn(),
  itemsGET: vi.fn(),
  itemsGET2: vi.fn(),
  getPublicMenu: vi.fn(),
  placePublicOrder: vi.fn(),
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

vi.mock("qrcode", () => ({ default: { toDataURL: () => Promise.resolve("data:image/png;base64,") } }));

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: "c1" }),
}));

vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ access: null, isLoading: false, isStaff: false, canSee: () => true, canWrite: () => true, canApprove: () => true }),
}));

const STORE = {
  id: "s1", code: "R1", name: "Te Ura", address: undefined, fiscalBranchNumber: 1, location: "Prishtinë",
  warehouseId: "w1", priceListId: undefined, receiptHeader: undefined, receiptFooter: undefined, isActive: true,
};
const item = (id: string, code: number, name: string, unit: string) => ({
  id, code, name, unit, description: undefined, type: 0, defaultTaxDefinitionId: undefined, defaultRevenueAccountId: undefined,
  defaultExpenseAccountId: undefined, defaultInventoryAccountId: undefined, defaultUnitPrice: undefined, barcodes: [],
});
const BURGER = item("i1", 1, "Burger", "copë");
const CHEESE = item("i2", 2, "Djathë", "kg");

function renderWith(children: ReactNode, path = "/") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.listPosStores.mockResolvedValue([STORE]);
  api.itemsGET.mockResolvedValue({ items: [BURGER, CHEESE], total: 2 });
  api.itemsGET2.mockImplementation((_c: string, id: string) => Promise.resolve([BURGER, CHEESE].find((i) => i.id === id)));
});

describe("Menu setup (P3)", () => {
  beforeEach(() => {
    api.listProductionCenters.mockResolvedValue([]);
    api.listModifierGroups.mockResolvedValue([]);
    api.getPosMenu.mockResolvedValue({ modifierGroups: [], combos: {}, productionCenters: {}, centers: [] });
    api.createModifierGroup.mockResolvedValue({ id: "g1", name: "Extras", minSelect: 0, maxSelect: 2, isActive: true, modifiers: [], itemIds: ["i1"] });
  });

  it("creates a modifier group with its modifiers, a recipe delta and the items that offer it", async () => {
    renderWith(<MenuSetup />);
    fireEvent.click(await screen.findByRole("button", { name: "New modifier group" }));
    const dialog = await screen.findByRole("dialog", { name: "New modifier group" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Extras" } });
    fireEvent.change(within(dialog).getByLabelText("Min"), { target: { value: "0" } });
    fireEvent.change(within(dialog).getByLabelText("Max"), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText("Modifier"), { target: { value: "Pa qepë" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add modifier" }));
    fireEvent.change(within(dialog).getAllByLabelText("Modifier")[1], { target: { value: "Djathë shtesë" } });
    fireEvent.change(within(dialog).getAllByLabelText("Price change")[1], { target: { value: "0.5" } });

    // The second modifier uses 50 g of cheese from stock.
    fireEvent.click(within(dialog).getAllByRole("combobox", { name: "Ingredient" })[1]);
    fireEvent.mouseDown(await screen.findByRole("option", { name: "2 · Djathë" }));
    fireEvent.change(await within(dialog).findByLabelText("Quantity (kg)"), { target: { value: "0.05" } });

    fireEvent.click(within(dialog).getByRole("combobox", { name: "Offered with" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: "1 · Burger" }));
    expect(await within(dialog).findByRole("button", { name: "Remove Burger" })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.createModifierGroup).toHaveBeenCalledWith("c1", {
        name: "Extras",
        minSelect: 0,
        maxSelect: 2,
        isActive: true,
        modifiers: [
          { id: undefined, name: "Pa qepë", priceDelta: 0, ingredientItemId: undefined, ingredientQuantity: undefined, sortOrder: 0, isActive: true },
          { id: undefined, name: "Djathë shtesë", priceDelta: 0.5, ingredientItemId: "i2", ingredientQuantity: 0.05, sortOrder: 1, isActive: true },
        ],
        itemIds: ["i1"],
      }),
    );
  });
});

describe("Floors and tables (P3)", () => {
  const TABLE = { id: "t1", floorId: "f1", name: "T1", seats: 4, shape: 0, x: 1, y: 1, width: 2, height: 2, isActive: true, qrToken: "abc123" };
  beforeEach(() => {
    api.listPosFloors.mockResolvedValue([{ id: "f1", storeId: "s1", name: "Salla", sortOrder: 0, isActive: true, tables: [TABLE] }]);
    api.updatePosTable.mockImplementation((_c: string, id: string, body: object) => Promise.resolve({ ...TABLE, ...body, id }));
  });

  it("moves and resizes a table and saves its position and size", async () => {
    renderWith(<PosFloors />);
    fireEvent.click(await screen.findByRole("button", { name: "Table T1" }));
    const editor = await screen.findByRole("form", { name: "Table" });
    fireEvent.click(within(editor).getByRole("button", { name: "Move right" }));
    fireEvent.click(within(editor).getByRole("button", { name: "Move right" }));
    fireEvent.click(within(editor).getByRole("button", { name: "Move down" }));
    fireEvent.change(within(editor).getByLabelText("Width"), { target: { value: "3" } });
    fireEvent.change(within(editor).getByLabelText("Height"), { target: { value: "4" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save table" }));

    await waitFor(() =>
      expect(api.updatePosTable).toHaveBeenCalledWith("c1", "t1", {
        floorId: "f1", name: "T1", seats: 4, shape: 0, x: 3, y: 2, width: 3, height: 4, isActive: true,
      }),
    );
    expect(api.listPosFloors).toHaveBeenCalledWith("c1", "s1");
  });

  it("prints one QR code per table for the public menu", async () => {
    renderWith(<PosFloors />);
    fireEvent.click(await screen.findByRole("button", { name: "QR codes" }));
    const dialog = await screen.findByRole("dialog", { name: "QR codes · Salla" });
    expect(await within(dialog).findByAltText("QR code for table T1")).toBeInTheDocument();
    expect(within(dialog).getAllByTestId("qr-card")).toHaveLength(1);
  });
});

describe("Public QR menu (P3)", () => {
  const MENU = {
    storeName: "Te Ura",
    tableName: "T4",
    items: [
      { id: "i1", name: "Burger", description: "Viçi, 200 g", price: 4.5, categoryName: "Kryesore" },
      { id: "i3", name: "Cola", description: undefined, price: 1.5, categoryName: "Pije" },
    ],
    modifierGroups: [{
      id: "g1", name: "Pjekja", minSelect: 1, maxSelect: 1, isActive: true, itemIds: ["i1"],
      modifiers: [
        { id: "m1", name: "Mesatare", priceDelta: 0, ingredientItemId: undefined, ingredientQuantity: undefined, sortOrder: 0, isActive: true },
        { id: "m2", name: "E pjekur mirë", priceDelta: 0, ingredientItemId: undefined, ingredientQuantity: undefined, sortOrder: 1, isActive: true },
      ],
    }],
  };

  const renderMenu = () =>
    renderWith(
      <Routes>
        <Route path="/menu/:token" element={<PublicMenu />} />
      </Routes>,
      "/menu/tok1",
    );

  it("shows the menu, enforces a required choice and sends the order with its modifiers", async () => {
    api.getPublicMenu.mockResolvedValue(MENU);
    api.placePublicOrder.mockResolvedValue(undefined);
    renderMenu();
    expect(await screen.findByText("Burger")).toBeInTheDocument();
    expect(screen.getByText("Table T4")).toBeInTheDocument();
    expect(screen.getByText("4.50 €")).toBeInTheDocument();
    expect(api.getPublicMenu).toHaveBeenCalledWith("tok1");

    fireEvent.click(screen.getByRole("button", { name: "Add Burger" }));
    const chooser = await screen.findByRole("dialog", { name: "Burger" });
    fireEvent.click(within(chooser).getByRole("button", { name: "Add to order" }));
    expect(await within(chooser).findByText("Choose at least 1 in Pjekja.")).toBeInTheDocument();
    fireEvent.click(within(chooser).getByLabelText("E pjekur mirë"));
    fireEvent.click(within(chooser).getByRole("button", { name: "Add to order" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Burger" })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Add Cola" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Cola" }));
    fireEvent.click(screen.getByRole("button", { name: "View order (3)" }));
    const basket = await screen.findByRole("dialog", { name: "Your order" });
    expect(within(basket).getAllByTestId("basket-line")).toHaveLength(2);
    fireEvent.change(within(basket).getByLabelText("Note for the waiter"), { target: { value: "Pa akull" } });
    fireEvent.click(within(basket).getByRole("button", { name: "Send order" }));

    await waitFor(() =>
      expect(api.placePublicOrder).toHaveBeenCalledWith("tok1", {
        lines: [
          { itemId: "i1", quantity: 1, modifierIds: ["m2"], note: undefined },
          { itemId: "i3", quantity: 2, modifierIds: [], note: undefined },
        ],
        note: "Pa akull",
      }),
    );
    expect(await screen.findByText("A waiter will confirm your order.")).toBeInTheDocument();
  });

  it("says a renewed or unknown code is no longer valid", async () => {
    api.getPublicMenu.mockRejectedValue(new ApiException("Not found", 404, "", {}, null));
    renderMenu();
    expect(await screen.findByText("This code is no longer valid")).toBeInTheDocument();
  });
});
