const axios = require("axios");
const { BasePrinter } = require("./base-printer");
const { getVatGroupLetter } = require("../vat-groups");

/**
 * Tremol fiscal printer adapter via ZFPLab middleware.
 * Communicates with ZFPLab desktop app at localhost:4444.
 */
class TremolPrinter extends BasePrinter {
  constructor(config) {
    super(config);
    this.baseUrl = config.zfplabUrl || "http://localhost:4444";
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 15000,
    });
  }

  async _exec(command, params = {}) {
    const { data } = await this.client.post("/exec", {
      command,
      params,
    });

    if (data.error) {
      throw new Error(`ZFPLab error: ${data.error}`);
    }
    return data;
  }

  async init() {
    return this.getStatus();
  }

  async getStatus() {
    try {
      const data = await this._exec("GetDeviceStatus");
      return {
        ok: !data.error,
        statusText: data.status || "ready",
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

    await this._exec("OpenReceipt", {
      operatorId: operator.id,
      operatorPassword: operator.password || "0000",
      uniqueSaleNumber: receipt.uniqueSaleNumber || `${operator.id}-${operator.code}-${Date.now()}`,
    });

    for (const item of items) {
      await this._exec("SellPLU", {
        name: item.name,
        taxGroup: getVatGroupLetter(item.vatRate),
        price: item.unitPrice,
        quantity: item.quantity,
        department: item.department || 0,
      });
    }

    if (payments.cash > 0) {
      await this._exec("Payment", { type: "cash", amount: payments.cash });
    }
    if (payments.card > 0) {
      await this._exec("Payment", { type: "card", amount: payments.card });
    }

    const result = await this._exec("CloseReceipt");

    return {
      fiscalNumber: result.receiptNumber || null,
      fiscalMemoryNumber: result.serialNumber || null,
      total: result.total || null,
      raw: result,
    };
  }

  async voidReceipt() {
    const result = await this._exec("VoidReceipt");
    return {
      success: true,
      fiscalNumber: result.receiptNumber || null,
      raw: result,
    };
  }

  async xReport() {
    const result = await this._exec("PrintXReport");
    return {
      totals: result,
      raw: result,
    };
  }

  async zReport() {
    const result = await this._exec("PrintZReport");
    return {
      zReportNumber: result.zReportNumber || null,
      totals: result.totals || result,
      receiptCount: result.receiptCount || 0,
      raw: result,
    };
  }

  async getPaperStatus() {
    try {
      const data = await this._exec("GetDeviceStatus");
      return {
        paperPresent: data.paperPresent !== false,
        paperLow: data.paperLow === true,
      };
    } catch {
      return { paperPresent: true, paperLow: false };
    }
  }
}

module.exports = { TremolPrinter };
