const iconv = require("iconv-lite");
const { BasePrinter } = require("./base-printer");
const { SerialConnection } = require("../serial");
const { getVatGroupNumber } = require("../vat-groups");

/**
 * Raw Datecs serial protocol adapter.
 * Binary packet format: STX | LEN | SEQ | CMD | DATA | POSTAMBLE | BCC | ETX
 */

const STX = 0x01;
const ETX = 0x03;
const POSTAMBLE = 0x05;

// Datecs command codes
const CMD = {
  STATUS: 0x4a, // 74 - Get status
  OPEN_FISCAL_RECEIPT: 0x30, // 48
  SALE_ITEM: 0x31, // 49
  SUBTOTAL: 0x33, // 51
  PAYMENT: 0x35, // 53
  CLOSE_FISCAL_RECEIPT: 0x38, // 56
  VOID_RECEIPT: 0x3c, // 60
  X_REPORT: 0x45, // 69
  Z_REPORT: 0x46, // 70
  GET_DATE_TIME: 0x3e, // 62
  PAPER_STATUS: 0x47, // 71
};

let sequenceNumber = 0;

function nextSeq() {
  sequenceNumber = (sequenceNumber + 1) % 256;
  if (sequenceNumber < 0x20) sequenceNumber = 0x20;
  return sequenceNumber;
}

function buildPacket(cmd, data = "") {
  const encoded = iconv.encode(data, "cp1250");
  const seq = nextSeq();
  const len = encoded.length + 10; // fixed overhead

  const packet = Buffer.alloc(len + 6);
  let offset = 0;

  packet[offset++] = STX;
  packet[offset++] = 0x20 + len;
  packet[offset++] = seq;
  packet[offset++] = cmd;
  encoded.copy(packet, offset);
  offset += encoded.length;
  packet[offset++] = POSTAMBLE;

  // BCC: sum of bytes from LEN to POSTAMBLE (inclusive)
  let bcc = 0;
  for (let i = 1; i < offset; i++) {
    bcc += packet[i];
  }
  // BCC as 4 ASCII hex nibbles
  const bccStr = bcc.toString(16).padStart(4, "0").toUpperCase();
  for (let i = 0; i < 4; i++) {
    packet[offset++] = bccStr.charCodeAt(i);
  }

  packet[offset++] = ETX;

  return packet.subarray(0, offset);
}

function parseResponse(buffer) {
  if (!buffer || buffer.length < 6) {
    throw new Error("Invalid response: too short");
  }

  const stx = buffer[0];
  if (stx !== STX) {
    throw new Error(`Invalid response: expected STX (0x01), got 0x${stx.toString(16)}`);
  }

  const etxIndex = buffer.indexOf(ETX);
  if (etxIndex === -1) {
    throw new Error("Invalid response: no ETX found");
  }

  const postambleIndex = buffer.indexOf(POSTAMBLE, 4);
  if (postambleIndex === -1) {
    throw new Error("Invalid response: no POSTAMBLE found");
  }

  const dataBuffer = buffer.subarray(4, postambleIndex);
  const decoded = iconv.decode(dataBuffer, "cp1250");

  return {
    cmd: buffer[3],
    data: decoded,
    raw: buffer.subarray(0, etxIndex + 1),
  };
}

class DatecsPrinter extends BasePrinter {
  constructor(config) {
    super(config);
    this.serial = new SerialConnection(config.port, config.baudRate || 115200);
  }

  async init() {
    await this.serial.open();
    return this.getStatus();
  }

  async _send(cmd, data = "") {
    if (!this.serial.port || !this.serial.port.isOpen) {
      await this.serial.open();
    }
    const packet = buildPacket(cmd, data);
    const response = await this.serial.writeAndRead(packet, 5000);
    return parseResponse(response);
  }

  async getStatus() {
    try {
      const resp = await this._send(CMD.STATUS);
      const parts = resp.data.split(",");
      return {
        ok: true,
        statusText: "ready",
        fiscalMemoryNumber: parts[0] || null,
        dateTime: parts[1] || null,
        raw: resp.data,
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

    // Open fiscal receipt: operator number, operator password, USN
    const usn = receipt.uniqueSaleNumber || `${operator.id}-${operator.code}-${Date.now()}`;
    await this._send(CMD.OPEN_FISCAL_RECEIPT, `${operator.id},${operator.password || "0000"},${usn}`);

    // Register sale items
    for (const item of items) {
      const vatGroup = getVatGroupNumber(item.vatRate);
      // Format: Name\tVatGroup,Price*Quantity
      const line = `${item.name}\t${vatGroup},${item.unitPrice.toFixed(2)}*${item.quantity}`;
      await this._send(CMD.SALE_ITEM, line);
    }

    // Subtotal
    await this._send(CMD.SUBTOTAL);

    // Payment
    if (payments.cash > 0) {
      await this._send(CMD.PAYMENT, `0,${payments.cash.toFixed(2)}`); // 0 = cash
    }
    if (payments.card > 0) {
      await this._send(CMD.PAYMENT, `2,${payments.card.toFixed(2)}`); // 2 = card
    }

    // Close receipt
    const closeResp = await this._send(CMD.CLOSE_FISCAL_RECEIPT);
    const parts = closeResp.data.split(",");

    return {
      fiscalNumber: parts[0] || null,
      fiscalMemoryNumber: parts[1] || null,
      total: parts[2] ? parseFloat(parts[2]) : null,
      raw: closeResp.data,
    };
  }

  async voidReceipt() {
    const resp = await this._send(CMD.VOID_RECEIPT);
    return {
      success: true,
      fiscalNumber: resp.data.split(",")[0] || null,
      raw: resp.data,
    };
  }

  async xReport() {
    const resp = await this._send(CMD.X_REPORT);
    return {
      totals: resp.data,
      raw: resp.data,
    };
  }

  async zReport() {
    const resp = await this._send(CMD.Z_REPORT);
    const parts = resp.data.split(",");
    return {
      zReportNumber: parts[0] || null,
      totals: resp.data,
      receiptCount: parts[1] ? parseInt(parts[1]) : 0,
      raw: resp.data,
    };
  }

  async getPaperStatus() {
    try {
      const resp = await this._send(CMD.PAPER_STATUS);
      const flags = parseInt(resp.data, 16) || 0;
      return {
        paperPresent: !(flags & 0x01),
        paperLow: !!(flags & 0x02),
      };
    } catch {
      return { paperPresent: true, paperLow: false };
    }
  }

  async close() {
    await this.serial.close();
  }
}

module.exports = { DatecsPrinter, buildPacket, parseResponse };
