const axios = require("axios");
const { BasePrinter } = require("./base-printer");
const { getVatGroupLetter } = require("../vat-groups");

/**
 * ErpNet.FP HTTP adapter — primary for Datecs FP-700X.
 * Communicates with the ErpNet.FP middleware at localhost:8001.
 */
class ErpNetPrinter extends BasePrinter {
  constructor(config) {
    super(config);
    this.baseUrl = config.erpnetUrl || "http://localhost:8001";
    this.printerId = config.printerId || "FP-700X";
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 15000,
    });
  }

  async init() {
    const status = await this.getStatus();
    if (!status.ok) {
      throw new Error(`Printer not ready: ${status.statusText || "unknown error"}`);
    }
    return status;
  }

  async getStatus() {
    try {
      const { data } = await this.client.get(
        `/printers/${this.printerId}/status`,
        { timeout: 3000 }
      );
      return {
        ok: data.ok !== false,
        statusText: data.statusText || "ready",
        fiscalMemoryNumber: data.serialNumber || null,
        dateTime: data.dateTime || null,
        raw: data,
      };
    } catch (err) {
      return {
        ok: false,
        statusText: err.message,
        fiscalMemoryNumber: null,
        dateTime: null,
        raw: null,
      };
    }
  }

  async printReceipt(receipt) {
    const { operator, items, payments } = receipt;

    const receiptData = {
      uniqueSaleNumber: receipt.uniqueSaleNumber || `${operator.id}-${operator.code}-${Date.now()}`,
      items: items.map((item) => ({
        text: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxGroup: getVatGroupLetter(item.vatRate),
        department: item.department || 0,
      })),
      payments: [],
    };

    if (payments.cash > 0) {
      receiptData.payments.push({ paymentType: "cash", amount: payments.cash });
    }
    if (payments.card > 0) {
      receiptData.payments.push({ paymentType: "card", amount: payments.card });
    }

    const { data } = await this.client.post(
      `/printers/${this.printerId}/receipt`,
      receiptData,
      { timeout: 10000 }
    );

    return {
      fiscalNumber: data.receiptNumber || data.fiscalNumber,
      fiscalMemoryNumber: data.serialNumber || data.fiscalMemoryNumber,
      total: data.receiptAmount || data.total,
      raw: data,
    };
  }

  async voidReceipt() {
    const { data } = await this.client.post(
      `/printers/${this.printerId}/receipt`,
      { reversalReceipt: true },
      { timeout: 10000 }
    );

    return {
      success: true,
      fiscalNumber: data.receiptNumber || data.fiscalNumber,
      raw: data,
    };
  }

  async xReport() {
    const { data } = await this.client.post(
      `/printers/${this.printerId}/xreport`,
      {},
      { timeout: 15000 }
    );

    return {
      totals: data,
      raw: data,
    };
  }

  async zReport() {
    const { data } = await this.client.post(
      `/printers/${this.printerId}/zreport`,
      {},
      { timeout: 15000 }
    );

    return {
      zReportNumber: data.zReportNumber || data.reportNumber,
      totals: data.totals || data,
      receiptCount: data.receiptCount || 0,
      raw: data,
    };
  }

  async getPaperStatus() {
    const status = await this.getStatus();
    return {
      paperPresent: status.raw?.paperPresent !== false,
      paperLow: status.raw?.paperNearEnd === true || status.raw?.paperLow === true,
    };
  }
}

module.exports = { ErpNetPrinter };
