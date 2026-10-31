import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { AttachmentsPanel } from "@/pages/shared/AttachmentsPanel";

// F11 — the real screen against an in-memory stand-in for the generated attachment endpoints
// (attachmentsAll / attachmentsPOST / attachmentsDELETE, and the download fetch), so it also checks
// what the client sends: the owner type and id of the document.

const COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const INVOICE_ID = "22222222-2222-2222-2222-222222222222";

type Stored = { id: string; ownerType: string; ownerId: string; fileName: string; contentType: string; sizeBytes: number; uploadedAtUtc: string; blob: Blob };
const store: Stored[] = [];
const OWNER_NAMES = ["Invoice", "Bill", "JournalEntry", "Partner", "ExpenseClaim", "StockDocument"];
const toResponse = (a: Stored) => ({
  id: a.id, ownerType: a.ownerType, ownerId: a.ownerId, fileName: a.fileName, contentType: a.contentType, sizeBytes: a.sizeBytes, uploadedAtUtc: a.uploadedAtUtc,
});

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    authorizedFetch: async (url: string) => {
      const id = String(url).split("/attachments/")[1]?.split("/")[0];
      const found = store.find((a) => a.id === id);
      return found ? new Response(found.blob, { status: 200 }) : new Response(null, { status: 404 });
    },
    apiClient: {
      ...actual.apiClient,
      attachmentsAll: async (_c: string, ownerType: number, ownerId: string) =>
        store.filter((a) => a.ownerType === OWNER_NAMES[ownerType] && a.ownerId === ownerId).map(toResponse),
      attachmentsPOST: async (_c: string, ownerType: string, ownerId: string, file: { data: File; fileName: string }) => {
        const record: Stored = {
          id: crypto.randomUUID(), ownerType, ownerId, fileName: file.fileName, contentType: file.data.type,
          sizeBytes: file.data.size, uploadedAtUtc: new Date().toISOString(), blob: file.data,
        };
        store.push(record);
        return toResponse(record);
      },
      attachmentsDELETE: async (_c: string, id: string) => {
        store.splice(store.findIndex((a) => a.id === id), 1);
      },
    },
  };
});

let objectUrlCounter = 0;

beforeAll(() => {
  // jsdom has no createObjectURL/revokeObjectURL implementation at all (confirmed: both are
  // `undefined` on jsdom's URL, not just unimplemented) — polyfill them the way any real browser
  // would provide them, scoped to this test file only.
  URL.createObjectURL = vi.fn(() => `blob:mock-${objectUrlCounter++}`);
  URL.revokeObjectURL = vi.fn();
});

beforeEach(() => {
  store.length = 0;
  vi.spyOn(window, "open").mockImplementation(() => null);
});

afterEach(() => {
  vi.mocked(window.open).mockRestore();
});

function renderPanel(documentId = INVOICE_ID) {
  return render(
    <IntlProviderWrapper>
      <AttachmentsPanel companyId={COMPANY_ID} documentKind="invoice" documentId={documentId} />
    </IntlProviderWrapper>,
  );
}

function makeImageFile(name = "receipt.png"): File {
  return new File(["fake-image-bytes"], name, { type: "image/png" });
}

function dropFile(file: File) {
  const dropzone = screen.getByTestId("attachments-dropzone");
  fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
}

describe("AttachmentsPanel", () => {
  it("starts empty", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText("No attachments yet.")).toBeInTheDocument());
  });

  it("uploads a dropped image file and shows it with a real thumbnail", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText("No attachments yet.")).toBeInTheDocument());

    dropFile(makeImageFile("receipt.png"));

    await waitFor(() => expect(screen.getByText("receipt.png")).toBeInTheDocument());
    const thumbnail = screen.getByRole("img", { name: "receipt.png" });
    expect(thumbnail).toHaveAttribute("src", expect.stringContaining("blob:mock-"));
  });

  it("uploads via the plain file-input fallback (drag-and-drop is not the only path)", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText("No attachments yet.")).toBeInTheDocument());

    const input = screen.getByLabelText("Or choose a file") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeImageFile("scan.png")] } });

    await waitFor(() => expect(screen.getByText("scan.png")).toBeInTheDocument());
  });

  it("rejects an unsupported file type and never uploads it", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText("No attachments yet.")).toBeInTheDocument());

    const textFile = new File(["hello"], "notes.txt", { type: "text/plain" });
    dropFile(textFile);

    await waitFor(() => expect(screen.getByText(/is not an image or PDF and was not uploaded/)).toBeInTheDocument());
    expect(screen.getByText("No attachments yet.")).toBeInTheDocument();
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
  });

  it("rejects a file over the 10MB limit and never uploads it", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText("No attachments yet.")).toBeInTheDocument());

    const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "huge.png", { type: "image/png" });
    dropFile(oversized);

    await waitFor(() => expect(screen.getByText(/is larger than 10 MB and was not uploaded/)).toBeInTheDocument());
    expect(screen.getByText("No attachments yet.")).toBeInTheDocument();
  });

  it("deletes an attachment after a confirm step", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText("No attachments yet.")).toBeInTheDocument());

    dropFile(makeImageFile("to-delete.png"));
    await waitFor(() => expect(screen.getByText("to-delete.png")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Delete to-delete.png" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(screen.queryByText("to-delete.png")).not.toBeInTheDocument());
    expect(screen.getByText("No attachments yet.")).toBeInTheDocument();
  });

  it("opens the original file when a thumbnail is clicked", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText("No attachments yet.")).toBeInTheDocument());

    dropFile(makeImageFile("open-me.png"));
    await waitFor(() => expect(screen.getByText("open-me.png")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Preview open-me.png" }));
    await waitFor(() => expect(screen.getByText("Preview")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Open original" }));
    await waitFor(() => expect(window.open).toHaveBeenCalledWith(expect.stringContaining("blob:mock-"), "_blank", "noopener,noreferrer"));
  });

  it("shows a placeholder region for the future extracted-fields (OCR) panel beside the preview", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText("No attachments yet.")).toBeInTheDocument());

    dropFile(makeImageFile("placeholder-check.png"));
    await waitFor(() => expect(screen.getByText("placeholder-check.png")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Preview placeholder-check.png" }));
    await waitFor(() => expect(screen.getByText("Extracted fields")).toBeInTheDocument());
    expect(screen.getByText(/OCR is not available yet/)).toBeInTheDocument();
  });

  it("an uploaded attachment survives unmounting and remounting the panel (navigating away and back)", async () => {
    const first = renderPanel();
    await waitFor(() => expect(screen.getByText("No attachments yet.")).toBeInTheDocument());

    dropFile(makeImageFile("persists.png"));
    await waitFor(() => expect(screen.getByText("persists.png")).toBeInTheDocument());

    expect(store[0]).toMatchObject({ ownerType: "Invoice", ownerId: INVOICE_ID });
    first.unmount();

    const second = renderPanel();
    await waitFor(() => expect(within(second.container).getByText("persists.png")).toBeInTheDocument());
  });
});
