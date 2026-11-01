import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { HotelChart } from "@/pages/pos/hotel/HotelChart";
import { utcToZonedInput, zonedInputToUtc } from "@/pages/pos/hotel/hotel-utils";

// docs/POS_PLAN.md P5 — the reservation chart, a new booking and check-in against a mocked client.
const api = vi.hoisted(() => ({
  listPosStores: vi.fn(),
  listPosRegisters: vi.fn(),
  getPosHotelCalendar: vi.fn(),
  listPosRoomTypes: vi.fn(),
  partnersAll: vi.fn(),
  createPosHotelBooking: vi.fn(),
  getPosHotelBooking: vi.fn(),
  checkInPosHotelBooking: vi.fn(),
  getPosTab: vi.fn(),
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

const ROOM_101 = { id: "rm1", roomTypeId: "rt1", number: "101", floor: "1", state: 0, isActive: true };
const ROOM_102 = { id: "rm2", roomTypeId: "rt1", number: "102", floor: "1", state: 1, isActive: true };
const TYPES = [{ id: "rt1", storeId: "s1", name: "Double", capacity: 2, rateItemId: "night", rate: 60, isActive: true, rooms: [ROOM_101, ROOM_102] }];

const booking = (over: Record<string, unknown> = {}) => ({
  id: "b1", number: "HB-00001", storeId: "s1", roomTypeId: "rt1", roomTypeName: "Double", roomId: "rm1", roomNumber: "101",
  arrival: "2026-11-03", departure: "2026-11-05", nights: 2, adults: 2, children: 0, state: 0, guestName: "Arta Krasniqi",
  phone: "+38344111222", email: undefined, companyPartnerId: undefined, channel: "Booking.com", nightlyRate: 55, notes: undefined,
  depositCardNumber: undefined, deposited: 0, folioTabId: undefined, postedThrough: undefined,
  guests: [{ id: "g1", fullName: "Arta Krasniqi", nationality: "XK", documentType: "ID card", documentNumber: "123456789", birthDate: "1990-04-02", isPrimary: true }],
  ...over,
});

const FOLIO = {
  id: "f1", number: "T-0042", name: "101 · Arta Krasniqi", kind: 3, state: 0, storeId: "s1", tableId: undefined, tableName: undefined, covers: 2,
  waiterName: "Recepsioni", openedAt: "2026-11-03T14:00:00Z", deliveryAddress: undefined, deliveryPhone: undefined, driverName: undefined, preBillCount: 0,
  lines: [{
    id: "fl1", lineNo: 1, itemId: "night", description: "Double room", quantity: 1, unitPrice: 55, discountAmount: 0, gross: 55, state: 1,
    seat: undefined, course: 1, note: "03.11.2026", modifiers: undefined, parentLineId: undefined, productionCenterId: undefined,
    sentAt: "2026-11-03T14:00:00Z", paidQuantity: 0, remaining: 1, remainingGross: 55, voidReason: undefined,
  }],
  taxes: [{ taxLetter: "D", taxRate: 0.08, gross: 55, net: 50.93, tax: 4.07 }], total: 55, paid: 0, due: 55,
};

function renderChart(url: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/pos/hotel" element={<HotelChart />} />
            <Route path="/pos/till/:registerId" element={<p>till</p>} />
          </Routes>
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("Hotel (P5)", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.listPosStores.mockResolvedValue([{ id: "s1", code: "H1", name: "Hotel Prishtina", isActive: true }]);
    api.listPosRegisters.mockResolvedValue([
      { id: "r9", storeId: "s1", storeName: "Hotel Prishtina", code: "REC", name: "Recepsioni", profile: 2, isActive: true, openSessionId: "ss9" },
    ]);
    api.listPosRoomTypes.mockResolvedValue(TYPES);
    api.partnersAll.mockResolvedValue([]);
    api.getPosHotelCalendar.mockResolvedValue({
      rooms: [
        { roomId: "rm1", number: "101", roomTypeId: "rt1", roomTypeName: "Double", state: 0, bookings: [] },
        { roomId: "rm2", number: "102", roomTypeId: "rt1", roomTypeName: "Double", state: 1, bookings: [booking({ id: "b2", roomId: "rm2", roomNumber: "102", guestName: "Besa" })] },
      ],
      unassigned: [],
    });
  });

  it("draws the rooms with their housekeeping state and bookings, and creates a booking with the right payload", async () => {
    api.createPosHotelBooking.mockImplementation(() => Promise.resolve(booking({ id: "b9", number: "HB-00009" })));
    api.getPosHotelBooking.mockResolvedValue(booking({ id: "b9", number: "HB-00009" }));
    renderChart("/pos/hotel?store=s1&from=2026-11-01&to=2026-11-07");

    const rooms = await screen.findAllByTestId("chart-room");
    expect(rooms).toHaveLength(2);
    expect(api.getPosHotelCalendar).toHaveBeenCalledWith("c1", "s1", "2026-11-01", "2026-11-07");
    expect(within(rooms[1]).getByTestId("room-state")).toHaveTextContent("Dirty");
    expect(within(rooms[1]).getByTestId("booking-bar")).toHaveTextContent("Besa");

    fireEvent.click(screen.getByRole("button", { name: "New booking" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Room type" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: "Double · 2 guests" }));
    fireEvent.change(within(dialog).getByLabelText("Arrival"), { target: { value: "2026-11-03" } });
    fireEvent.change(within(dialog).getByLabelText("Departure"), { target: { value: "2026-11-05" } });
    fireEvent.change(within(dialog).getByLabelText("Adults"), { target: { value: "2" } });
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Room" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: "101" }));
    fireEvent.change(within(dialog).getByLabelText("Agreed nightly rate"), { target: { value: "55" } });
    fireEvent.change(within(dialog).getByLabelText("Guest"), { target: { value: "Arta Krasniqi" } });
    fireEvent.change(within(dialog).getByLabelText("Phone"), { target: { value: "+38344111222" } });
    fireEvent.change(within(dialog).getByLabelText("Channel"), { target: { value: "Booking.com" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.createPosHotelBooking).toHaveBeenCalled());
    expect(api.createPosHotelBooking.mock.calls[0][0]).toBe("c1");
    expect(api.createPosHotelBooking.mock.calls[0][1]).toEqual({
      storeId: "s1", roomTypeId: "rt1", arrival: "2026-11-03", departure: "2026-11-05", guestName: "Arta Krasniqi", adults: 2, children: 0,
      roomId: "rm1", phone: "+38344111222", email: undefined, companyPartnerId: undefined, channel: "Booking.com", nightlyRate: 55, notes: undefined,
    });
    // The new booking opens.
    expect(await screen.findByRole("dialog", { name: /HB-00009/ })).toBeInTheDocument();
  });

  it("checks a guest in, then shows the folio as the server has it", async () => {
    api.getPosHotelBooking.mockResolvedValue(booking());
    api.checkInPosHotelBooking.mockResolvedValue(booking({ state: 1, folioTabId: "f1" }));
    api.getPosTab.mockResolvedValue(FOLIO);
    renderChart("/pos/hotel?store=s1&from=2026-11-01&to=2026-11-07&booking=b1");

    const details = await screen.findByTestId("booking-details");
    expect(within(details).getByTestId("booking-state")).toHaveTextContent("Reserved");
    expect(within(details).getByTestId("booking-guests")).toHaveTextContent("123456789");
    expect(within(details).queryByTestId("folio")).toBeNull();

    fireEvent.click(within(details).getByRole("button", { name: /Check in/ }));
    await waitFor(() => expect(api.checkInPosHotelBooking).toHaveBeenCalledWith("c1", "b1"));
    expect(await within(details).findByText("In house")).toBeInTheDocument();
    const folio = await within(details).findByTestId("folio");
    expect(api.getPosTab).toHaveBeenCalledWith("c1", "f1");
    expect(folio).toHaveTextContent("Double room");
    expect(folio).toHaveTextContent("03.11.2026");
    expect(within(folio).getByTestId("folio-due")).toHaveTextContent("55.00");
    // In house: the folio is paid at a café/restaurant till of the store.
    fireEvent.click(within(details).getByRole("button", { name: /Pay at till/ }));
    expect(await screen.findByText("till")).toBeInTheDocument();
  });

  it("reads an event's start in Kosovo time and stores it in UTC, summer and winter", () => {
    expect(zonedInputToUtc("2026-07-01T20:00")).toBe("2026-07-01T18:00:00.000Z");
    expect(zonedInputToUtc("2026-12-31T22:00")).toBe("2026-12-31T21:00:00.000Z");
    expect(utcToZonedInput("2026-12-31T21:00:00Z")).toBe("2026-12-31T22:00");
    expect(utcToZonedInput("2026-07-01T18:00:00Z")).toBe("2026-07-01T20:00");
  });
});
