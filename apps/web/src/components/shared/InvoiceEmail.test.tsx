import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InvoiceEmailCard, InvoicePdfButton } from "@/components/shared/InvoiceEmail";
import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { splitRecipients } from "@/lib/invoice-email";

const api = vi.hoisted(() => ({
  listInvoiceEmails: vi.fn(),
  emailInvoice: vi.fn(),
  retryInvoiceEmail: vi.fn(),
}));

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  const mocked = Object.fromEntries(Object.entries(api).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)]));
  return { ...actual, apiClient: { ...actual.apiClient, ...mocked } };
});

const download = vi.hoisted(() => vi.fn());
vi.mock("@/lib/download", () => ({ downloadFileResponse: download }));

function wrap(node: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

function card(customerEmail: string | undefined = "books@bar.test", canSend = true) {
  return wrap(
    <InvoiceEmailCard
      companyId="c1"
      invoiceId="i1"
      documentLabel="Invoice"
      number="01/2026"
      customerName="Bar Prishtina"
      customerEmail={customerEmail || undefined}
      canSend={canSend}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listInvoiceEmails.mockResolvedValue([]);
});

describe("Invoice email", () => {
  it("splits typed recipients on commas, semicolons and spaces", () => {
    expect(splitRecipients(" a@x.test, b@x.test;c@x.test  d@x.test ,")).toEqual(["a@x.test", "b@x.test", "c@x.test", "d@x.test"]);
  });

  it("sends to the customer's address with the message and language", async () => {
    api.emailInvoice.mockResolvedValue([{ id: "e1", recipient: "books@bar.test", state: "Pending", attempts: 0, createdAt: "2026-11-19T09:00:00Z" }]);
    card();
    expect(await screen.findByText("Not emailed yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Email…" }));
    expect(screen.getByText("Email Invoice 01/2026")).toBeInTheDocument();
    expect(screen.getByLabelText("To")).toHaveValue("books@bar.test");

    fireEvent.change(screen.getByLabelText("To"), { target: { value: "books@bar.test, owner@bar.test" } });
    fireEvent.change(screen.getByLabelText("Message (optional)"), { target: { value: "  Thanks!  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(api.emailInvoice).toHaveBeenCalledWith("c1", "i1", { to: ["books@bar.test", "owner@bar.test"], message: "Thanks!", culture: "sq" }),
    );
    await waitFor(() => expect(api.listInvoiceEmails).toHaveBeenCalledTimes(2));
  });

  it("asks for an address when the customer has none, and shows the server's refusal", async () => {
    api.emailInvoice.mockRejectedValue(new Error("\"nope\" is not a valid email address."));
    card("");
    fireEvent.click(await screen.findByRole("button", { name: "Email…" }));
    expect(screen.getByText(/Bar Prishtina has no email address/)).toBeInTheDocument();
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "nope" } });
    fireEvent.click(send);
    expect(await screen.findByText("\"nope\" is not a valid email address.")).toBeInTheDocument();
  });

  it("lists what was sent and retries a failure", async () => {
    api.listInvoiceEmails.mockResolvedValue([
      { id: "e1", recipient: "books@bar.test", state: "Failed", attempts: 1, lastError: "Email API answered 422: mailbox unknown", createdAt: "2026-11-19T09:00:00Z" },
    ]);
    api.retryInvoiceEmail.mockResolvedValue({ id: "e1", recipient: "books@bar.test", state: "Pending", attempts: 0, createdAt: "2026-11-19T09:00:00Z" });
    card();
    expect(await screen.findByText("Email API answered 422: mailbox unknown")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(api.retryInvoiceEmail).toHaveBeenCalledWith("c1", "i1", "e1"));
  });

  it("hides sending and retry without Sales write access", async () => {
    api.listInvoiceEmails.mockResolvedValue([
      { id: "e1", recipient: "books@bar.test", state: "Failed", attempts: 1, lastError: "x", createdAt: "2026-11-19T09:00:00Z" },
    ]);
    card("books@bar.test", false);
    expect(await screen.findByText("books@bar.test")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Email…" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("downloads the server's PDF", async () => {
    const file = { data: new Blob(["%PDF"]), fileName: "invoice-01-2026.pdf", status: 200 };
    const load = vi.fn().mockResolvedValue(file);
    wrap(<InvoicePdfButton fileName="01-2026.pdf" load={load} />);
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await waitFor(() => expect(download).toHaveBeenCalledWith(file, "01-2026.pdf"));
  });
});
