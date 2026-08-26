const { SerialPort } = require("serialport");

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

class SerialConnection {
  constructor(portPath, baudRate = 115200) {
    this.portPath = portPath;
    this.baudRate = baudRate;
    this.port = null;
  }

  async open() {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        this.port = new SerialPort({
          path: this.portPath,
          baudRate: this.baudRate,
          autoOpen: false,
        });

        await new Promise((resolve, reject) => {
          this.port.open((err) => (err ? reject(err) : resolve()));
        });

        return this.port;
      } catch (err) {
        console.error(
          `[Serial] Open attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`
        );
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        } else {
          throw new Error(
            `Failed to open serial port ${this.portPath} after ${MAX_RETRIES} attempts: ${err.message}`
          );
        }
      }
    }
  }

  async write(data) {
    if (!this.port || !this.port.isOpen) {
      throw new Error("Serial port is not open");
    }
    return new Promise((resolve, reject) => {
      this.port.write(data, (err) => (err ? reject(err) : resolve()));
    });
  }

  async read(timeout = 5000) {
    if (!this.port || !this.port.isOpen) {
      throw new Error("Serial port is not open");
    }
    return new Promise((resolve, reject) => {
      const chunks = [];
      const timer = setTimeout(() => {
        this.port.removeAllListeners("data");
        if (chunks.length > 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error("Serial read timeout"));
        }
      }, timeout);

      this.port.on("data", (chunk) => {
        chunks.push(chunk);
        // Check for ETX (0x03) to detect end of Datecs response
        if (chunk.includes(0x03)) {
          clearTimeout(timer);
          this.port.removeAllListeners("data");
          resolve(Buffer.concat(chunks));
        }
      });
    });
  }

  async close() {
    if (this.port && this.port.isOpen) {
      return new Promise((resolve, reject) => {
        this.port.close((err) => (err ? reject(err) : resolve()));
      });
    }
  }

  async writeAndRead(data, timeout = 5000) {
    await this.write(data);
    return this.read(timeout);
  }
}

module.exports = { SerialConnection };
