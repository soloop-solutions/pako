/**
 * Abstract base class for fiscal printer adapters.
 * All printer implementations must extend this class.
 */
class BasePrinter {
  constructor(config) {
    this.config = config;
    if (new.target === BasePrinter) {
      throw new Error("Cannot instantiate BasePrinter directly");
    }
  }

  async init() {
    throw new Error("init() must be implemented by subclass");
  }

  async getStatus() {
    throw new Error("getStatus() must be implemented by subclass");
  }

  /**
   * Print a fiscal receipt.
   * @param {Object} receipt - { operator, items: [{ name, quantity, unitPrice, vatRate, department }], payments: { cash, card } }
   * @returns {Object} - { fiscalNumber, fiscalMemoryNumber, total }
   */
  async printReceipt(receipt) {
    throw new Error("printReceipt() must be implemented by subclass");
  }

  /**
   * Void the last fiscal receipt.
   * @returns {Object} - { success, fiscalNumber }
   */
  async voidReceipt() {
    throw new Error("voidReceipt() must be implemented by subclass");
  }

  /**
   * Print X-report (daily read without reset).
   * @returns {Object} - { totals }
   */
  async xReport() {
    throw new Error("xReport() must be implemented by subclass");
  }

  /**
   * Print Z-report (daily close with reset).
   * @returns {Object} - { zReportNumber, totals, receiptCount }
   */
  async zReport() {
    throw new Error("zReport() must be implemented by subclass");
  }

  /**
   * Get paper status.
   * @returns {Object} - { paperPresent, paperLow }
   */
  async getPaperStatus() {
    throw new Error("getPaperStatus() must be implemented by subclass");
  }
}

module.exports = { BasePrinter };
