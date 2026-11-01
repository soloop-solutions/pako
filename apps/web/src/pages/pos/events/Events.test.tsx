import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PosOrderResponse, RegisterResponse, StoreResponse } from "@pako/shared";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { CouponReceipt } from "@/pages/pos/CouponReceipt";
import { Events } from "@/pages/pos/events/Events";
import { TicketScanner } from "@/pages/pos/events/TicketScanner";

// docs/POS_PLAN.md P5 — the door scanner, an event's final headcount and tickets on the coupon,
// against a mocked client.
const api = vi.hoisted(() => ({
  listPosTicketedEvents: vi.fn(),
  scanPosTicket: vi.fn(),
  listPosStores: vi.fn(),
  listPosRegisters: vi.fn(),
  listPosVenues: vi.fn(),
  listPosEventBookings: vi.fn(),
  setPosEventFinalGuests: vi.fn(),
  getPosTab: vi.fn(),
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

vi.mock("qrcode", () => ({ default: { toDataURL: (text: string) => Promise.resolve(`data:image/png;base64,${text}`) } }));

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: "c1" }),
}));

vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ access: null, isLoading: false, isStaff: false, canSee: () => true, canWrite: () => true, canApprove: () => true }),
}));

function renderAt(url: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/pos/scan" element={<TicketScanner />} />
            <Route path="/pos/events" element={<Events />} />
          </Routes>
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

const CONCERT = {
  id: "e1", storeId: "s1", name: "Koncert Viti i Ri", startsAt: "2026-12-31T21:00:00Z", capacity: 500, isActive: true, sold: 120, used: 40,
  ticketTypes: [{ itemId: "tk1", quota: 400, sold: 100 }, { itemId: "tk2", quota: 100, sold: 20 }],
};

describe("Ticketed events and venues (P5)", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.listPosStores.mockResolvedValue([{ id: "s1", code: "V1", name: "Salla Diamant", isActive: true }]);
    api.listPosRegisters.mockResolvedValue([
      { id: "r1", storeId: "s1", storeName: "Salla Diamant", code: "B1", name: "Bari", profile: 3, isActive: true, openSessionId: "ss1" },
    ]);
    api.itemsGET.mockResolvedValue({ items: [{ id: "pk1", code: 7, name: "Menu Gold", unit: "person" }], total: 1 });
    api.itemsGET2.mockResolvedValue({ id: "pk1", code: 7, name: "Menu Gold", unit: "person" });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("the door scanner shows VALID, ALREADY USED with the time, and INVALID, then clears for the next guest", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.listPosTicketedEvents.mockResolvedValue([CONCERT]);
    api.scanPosTicket
      .mockResolvedValueOnce({ result: "Valid", ticketType: "VIP", usedAt: "2026-12-31T21:05:00Z" })
      .mockResolvedValueOnce({ result: "AlreadyUsed", ticketType: "VIP", usedAt: "2026-12-31T21:05:00Z" })
      .mockResolvedValueOnce({ result: "Invalid", ticketType: undefined, usedAt: undefined });
    renderAt("/pos/scan?event=e1");

    expect(await screen.findByTestId("scan-counts")).toHaveTextContent("40 in · 120 sold · capacity 500");
    const input = screen.getByLabelText("Ticket code");
    const verdict = screen.getByTestId("scan-verdict");
    const scan = async (code: string) => {
      await waitFor(() => expect(input).toBeEnabled());
      fireEvent.change(input, { target: { value: code } });
      fireEvent.submit(input.closest("form") as HTMLFormElement);
    };

    await scan(" A1B2C3D4E5F6A7B8C9 ");
    await waitFor(() => expect(verdict).toHaveAttribute("data-verdict", "valid"));
    expect(api.scanPosTicket).toHaveBeenLastCalledWith("c1", "e1", { code: "A1B2C3D4E5F6A7B8C9" });
    expect(verdict).toHaveTextContent("VALID");
    expect(verdict).toHaveTextContent("VIP");
    // The field is cleared for the next code.
    expect(input).toHaveValue("");

    await scan("A1B2C3D4E5F6A7B8C9");
    await waitFor(() => expect(verdict).toHaveAttribute("data-verdict", "used"));
    expect(verdict).toHaveTextContent("ALREADY USED");
    // 21:05 UTC is 22:05 in Prishtina.
    expect(screen.getByTestId("scan-used-at")).toHaveTextContent("10:05:00 PM");

    await scan("FFFF");
    await waitFor(() => expect(verdict).toHaveAttribute("data-verdict", "invalid"));
    expect(verdict).toHaveTextContent("INVALID");

    // A few seconds later the screen is ready for the next guest.
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    await waitFor(() => expect(verdict).toHaveAttribute("data-verdict", "idle"));
  });

  it("sets an event's final headcount: the bill opens with the package per guest, as the server prices it", async () => {
    api.listPosVenues.mockResolvedValue([{ id: "v1", storeId: "s1", name: "Salla e madhe", capacity: 300, isActive: true }]);
    api.listPosEventBookings.mockResolvedValue([{
      id: "ev1", number: "EV-00001", storeId: "s1", venueId: "v1", venueName: "Salla e madhe", date: "2026-11-21", from: "19:00:00", to: "23:30:00",
      state: 1, customerId: undefined, customerName: "Dasma Berisha", phone: "+38349000111", packageItemId: "pk1", pricePerGuest: 25, guestsEstimated: 120,
      guestsFinal: undefined, banquetNotes: "Torta në ora 22:00", notes: undefined, depositCardNumber: "EV-00001", deposited: 1000, tabId: undefined,
    }]);
    const bill = {
      id: "tb1", number: "T-0100", name: "EV-00001 · Dasma Berisha", kind: 4, state: 0, storeId: "s1", tableId: undefined, tableName: undefined, covers: 118,
      waiterName: "Admin", openedAt: "2026-11-21T17:00:00Z", deliveryAddress: undefined, deliveryPhone: undefined, driverName: undefined, preBillCount: 0,
      lines: [{
        id: "bl1", lineNo: 1, itemId: "pk1", description: "Menu Gold", quantity: 118, unitPrice: 25, discountAmount: 0, gross: 2950, state: 1, seat: undefined,
        course: 1, note: undefined, modifiers: undefined, parentLineId: undefined, productionCenterId: undefined, sentAt: "2026-11-21T17:00:00Z",
        paidQuantity: 0, remaining: 118, remainingGross: 2950, voidReason: undefined,
      }],
      taxes: [{ taxLetter: "C", taxRate: 0.18, gross: 2950, net: 2500, tax: 450 }], total: 2950, paid: 0, due: 2950,
    };
    api.setPosEventFinalGuests.mockResolvedValue(bill);
    api.getPosTab.mockResolvedValue(bill);
    renderAt("/pos/events?month=2026-11&event=ev1");

    const details = await screen.findByTestId("event-details");
    expect(api.listPosEventBookings).toHaveBeenCalledWith("c1", "2026-11-01", "2026-11-30", undefined);
    expect(within(details).getByTestId("deposit-card")).toHaveTextContent("EV-00001");
    expect(within(details).queryByTestId("folio")).toBeNull();

    fireEvent.change(within(details).getByLabelText("Final headcount"), { target: { value: "118" } });
    fireEvent.click(within(details).getByRole("button", { name: /Set final headcount/ }));
    await waitFor(() => expect(api.setPosEventFinalGuests).toHaveBeenCalledWith("c1", "ev1", { guests: 118 }));
    const folio = await within(details).findByTestId("folio");
    expect(folio).toHaveTextContent("Menu Gold");
    expect(folio).toHaveTextContent("2950.00");
    expect(within(folio).getByTestId("folio-due")).toHaveTextContent("2950.00");
    // The bill is now open at the store's till for extras and payment.
    expect(within(details).getByRole("button", { name: /Open bill at till/ })).toBeEnabled();
  });

  it("prints each ticket the sale issued after the coupon, with its QR", async () => {
    const order = {
      id: "o1", clientUuid: "u1", number: "K1-00007", kind: 0, state: 0, orderedAt: "2026-12-01T10:00:00Z", operatorName: "Arta",
      customerId: undefined, originalOrderId: undefined, total: 30, totalTax: 4.58, totalDiscount: 0, change: 0, registerId: "r1",
      lines: [{ id: "ol1", lineNo: 1, itemId: "tk1", description: "Biletë VIP", unit: "copë", quantity: 2, unitPrice: 15, discountAmount: 0, taxLetter: "C", gross: 30, net: 25.42, tax: 4.58, returnable: 2 }],
      payments: [{ paymentMethodId: "cash", name: "Arka", amount: 30, tendered: undefined, tip: 0 }],
      taxes: [{ taxLetter: "C", taxRate: 0.18, gross: 30, net: 25.42, tax: 4.58 }],
      fiscal: undefined,
      tickets: [
        { code: "AAAA1111", eventName: "Koncert Viti i Ri", startsAt: "2026-12-31T21:00:00Z", ticketType: "VIP", state: 0 },
        { code: "BBBB2222", eventName: "Koncert Viti i Ri", startsAt: "2026-12-31T21:00:00Z", ticketType: "VIP", state: 0 },
      ],
    } as unknown as PosOrderResponse;
    render(
      <IntlProviderWrapper>
        <CouponReceipt
          order={order}
          store={{ id: "s1", name: "Salla Diamant", location: "Prishtinë" } as unknown as StoreResponse}
          register={{ id: "r1", code: "K1" } as unknown as RegisterResponse}
          issuer={{ companyName: "Diamant LLC" }}
        />
      </IntlProviderWrapper>,
    );
    const coupon = screen.getByTestId("coupon");
    const tickets = within(coupon).getAllByTestId("coupon-ticket");
    expect(tickets).toHaveLength(2);
    expect(tickets[0]).toHaveTextContent("Koncert Viti i Ri");
    expect(tickets[0]).toHaveTextContent("VIP");
    expect(tickets[0]).toHaveTextContent("AAAA1111");
    // 21:00 UTC on 31 Dec is 22:00 in Prishtina.
    expect(tickets[0]).toHaveTextContent("10:00 PM");
    expect(await within(tickets[1]).findByRole("img", { name: "BBBB2222" })).toHaveAttribute("src", "data:image/png;base64,BBBB2222");
  });
});
