const { BasePrinter } = require("./base-printer");

let receiptCounter = 0;
let zReportCounter = 0;

/**
 * Mock printer — returns fake responses without any hardware.
 * Use middleware: "mock" in config.json for testing.
 */
class MockPrinter extends BasePrinter {
  async getStatus() {
    return {
      ok: true,
      statusText: "ready (mock)",
      fiscalMemoryNumber: "MOCK000001",
      serialNumber: "MOCK000001",
      dateTime: new Date().toISOString(),
    };
  }

  async printReceipt(receipt) {
    receiptCounter += 1;
    const fiscalNumber = String(receiptCounter).padStart(6, "0");
    console.log(`[Mock] Receipt #${fiscalNumber} — ${receipt.items?.length || 0} items`);
    return {
      fiscalNumber,
      fiscalMemoryNumber: "MOCK000001",
      total: receipt.items?.reduce((s, i) => s + i.unitPrice * i.quantity, 0) || 0,
      raw: { mock: true },
    };
  }

  async voidReceipt() {
    console.log("[Mock] Void receipt");
    return { success: true, fiscalNumber: null, raw: { mock: true } };
  }

  async xReport() {
    console.log("[Mock] X-Report");
    return { totals: { totalAmount: 0, totalCash: 0, totalCard: 0 }, raw: { mock: true } };
  }

  async zReport() {
    zReportCounter += 1;
    const count = receiptCounter;
    receiptCounter = 0;
    console.log(`[Mock] Z-Report #${zReportCounter} covering ${count} receipts`);
    return {
      zReportNumber: String(zReportCounter).padStart(4, "0"),
      receiptCount: count,
      totals: {
        totalAmount: 0,
        totalCash: 0,
        totalCard: 0,
        vatAmount0: 0,
        vatAmount8: 0,
        vatAmount18: 0,
        baseAmount0: 0,
        baseAmount8: 0,
        baseAmount18: 0,
      },
      raw: { mock: true },
    };
  }

  async getPaperStatus() {
    return { paperPresent: true, paperLow: false };
  }
}

module.exports = { MockPrinter };
