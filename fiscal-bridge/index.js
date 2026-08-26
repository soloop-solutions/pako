const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { SerialPort } = require("serialport");

const app = express();
app.use(cors());
app.use(express.json());

// When packaged with pkg, __dirname points to the snapshot.
// Config must live next to the .exe so it is writable.
const isPkg = typeof process.pkg !== "undefined";
const CONFIG_DIR = isPkg ? path.dirname(process.execPath) : __dirname;
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG = {
  brand: "datecs",
  middleware: "datecs",
  port: "",
  baudRate: 115200,
  operatorId: "1",
  operatorPassword: "0000",
  configured: false,
};

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function createPrinter(config) {
  const middleware = config.middleware || config.brand;
  switch (middleware) {
    case "erpnet": {
      const { ErpNetPrinter } = require("./lib/printers/erpnet");
      return new ErpNetPrinter(config);
    }
    case "datecs":
    case "datecs-serial": {
      const { DatecsPrinter } = require("./lib/printers/datecs");
      return new DatecsPrinter(config);
    }
    case "tremol":
    case "zfplab": {
      const { TremolPrinter } = require("./lib/printers/tremol-zfplab");
      return new TremolPrinter(config);
    }
    case "mock": {
      const { MockPrinter } = require("./lib/printers/mock");
      return new MockPrinter(config);
    }
    default:
      throw new Error(`Unknown printer middleware/brand: ${middleware}`);
  }
}

let printer = null;

function getPrinter() {
  if (!printer) {
    const config = loadConfig();
    printer = createPrinter(config);
  }
  return printer;
}

function openBrowser(url) {
  const platform = process.platform;
  if (platform === "win32") exec(`start ${url}`);
  else if (platform === "darwin") exec(`open ${url}`);
  else exec(`xdg-open ${url}`);
}

// ─── Setup UI ────────────────────────────────────────────────────────────────

const SETUP_HTML = `<!DOCTYPE html>
<html lang="sq">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pako Bridge — Konfigurimi</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #f5f5f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
    .card { background: white; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); width: 100%; max-width: 480px; overflow: hidden; }
    .header { background: #4f46e5; padding: 24px 28px; color: white; }
    .header h1 { font-size: 20px; font-weight: 700; }
    .header p { font-size: 13px; opacity: 0.8; margin-top: 4px; }
    .body { padding: 28px; }
    .field { margin-bottom: 18px; }
    label { display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px; }
    select, input { width: 100%; padding: 9px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; color: #111; background: white; }
    select:focus, input:focus { outline: none; border-color: #4f46e5; box-shadow: 0 0 0 3px rgba(79,70,229,0.1); }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .hint { font-size: 12px; color: #6b7280; margin-top: 4px; }
    .btn { width: 100%; padding: 11px; background: #4f46e5; color: white; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; margin-top: 8px; }
    .btn:hover { background: #4338ca; }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .status { margin-top: 18px; padding: 14px 16px; border-radius: 8px; font-size: 13px; display: none; }
    .status.ok { background: #ecfdf5; border: 1px solid #6ee7b7; color: #065f46; }
    .status.err { background: #fef2f2; border: 1px solid #fca5a5; color: #991b1b; }
    .status.info { background: #eff6ff; border: 1px solid #93c5fd; color: #1e40af; }
    .status-title { font-weight: 700; margin-bottom: 4px; }
    .divider { border: none; border-top: 1px solid #f3f4f6; margin: 22px 0; }
    .service-row { display: flex; align-items: center; justify-content: space-between; }
    .service-text p { font-size: 13px; color: #374151; font-weight: 600; }
    .service-text span { font-size: 12px; color: #6b7280; }
    .btn-sm { padding: 8px 16px; background: #f3f4f6; color: #374151; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
    .btn-sm:hover { background: #e5e7eb; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; }
    .badge-green { background: #d1fae5; color: #065f46; }
    .badge-gray { background: #f3f4f6; color: #6b7280; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>Pako Bridge</h1>
      <p>Konfigurimi i printerit fiskal</p>
    </div>
    <div class="body">
      <div class="field">
        <label>Porta COM <span id="port-loading" style="color:#a5b4fc;font-weight:400">(duke ngarkuar...)</span></label>
        <select id="port">
          <option value="">— Zgjidhni portën —</option>
        </select>
        <div class="hint">Lidhni printerin me USB para se të zgjidhni portën.</div>
      </div>

      <div class="field">
        <label>Marka e printerit</label>
        <select id="brand">
          <option value="datecs">Datecs (FP-700, FP-550, MP-55B...)</option>
          <option value="zfplab">Tremol (kërkon ZFPLab)</option>
          <option value="erpnet">Datecs me ErpNet.FP middleware</option>
          <option value="mock">Mock — test pa printer</option>
        </select>
      </div>

      <div class="row">
        <div class="field">
          <label>ID Operatorit</label>
          <input type="text" id="operatorId" value="1" />
        </div>
        <div class="field">
          <label>Fjalëkalimi</label>
          <input type="text" id="operatorPassword" value="0000" />
        </div>
      </div>
      <div class="hint" style="margin-top:-12px;margin-bottom:18px">ID dhe fjalëkalimi vendosen nga teknicieni që instaloi printerin.</div>

      <button class="btn" id="saveBtn" onclick="save()">Ruaj &amp; Testo Lidhjen</button>

      <div class="status" id="status">
        <div class="status-title" id="status-title"></div>
        <div id="status-msg"></div>
      </div>

      <hr class="divider" id="service-divider" style="display:none">

      <div class="service-row" id="service-row" style="display:none">
        <div class="service-text">
          <p>Nisja automatike <span id="service-badge" class="badge badge-gray">jo aktiv</span></p>
          <span>Instalo si Windows Service që Bridge të niset automatikisht me kompjuter.</span>
        </div>
        <button class="btn-sm" id="serviceBtn" onclick="installService()">Instalo Service</button>
      </div>
    </div>
  </div>

  <script>
    async function loadPorts() {
      try {
        const res = await fetch('/setup/ports');
        const { ports } = await res.json();
        const sel = document.getElementById('port');
        document.getElementById('port-loading').textContent = '';
        ports.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.path;
          opt.textContent = p.path + (p.manufacturer ? '  —  ' + p.manufacturer : '');
          sel.appendChild(opt);
        });
        if (ports.length === 1) sel.value = ports[0].path;
      } catch {
        document.getElementById('port-loading').textContent = '(gabim)';
      }
    }

    async function save() {
      const port = document.getElementById('port').value;
      const brand = document.getElementById('brand').value;
      const operatorId = document.getElementById('operatorId').value;
      const operatorPassword = document.getElementById('operatorPassword').value;

      if (!port && brand !== 'mock' && brand !== 'zfplab' && brand !== 'erpnet') {
        showStatus('err', 'Porta COM mungon', 'Zgjidhni portën COM para se të vazhdoni.');
        return;
      }

      const btn = document.getElementById('saveBtn');
      btn.disabled = true;
      btn.textContent = 'Duke testuar...';
      showStatus('info', 'Duke u lidhur...', 'Po testojmë lidhjen me printerin.');

      try {
        const res = await fetch('/setup/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ port, brand, middleware: brand, operatorId, operatorPassword }),
        });
        const data = await res.json();

        if (data.success) {
          showStatus('ok', 'Konfigurimi u ruajt!', data.printerStatus?.statusText || 'Printeri u lidh me sukses. Mund ta mbyllni këtë dritare.');
          document.getElementById('service-divider').style.display = '';
          document.getElementById('service-row').style.display = '';
          btn.textContent = 'Ruajtur ✓';
        } else {
          showStatus('err', 'Gabim', data.error || 'Lidhja me printerin dështoi. Kontrolloni kabllot dhe portën COM.');
          btn.disabled = false;
          btn.textContent = 'Ruaj & Testo Lidhjen';
        }
      } catch (e) {
        showStatus('err', 'Gabim rrjeti', e.message);
        btn.disabled = false;
        btn.textContent = 'Ruaj & Testo Lidhjen';
      }
    }

    async function installService() {
      const btn = document.getElementById('serviceBtn');
      btn.disabled = true;
      btn.textContent = 'Duke instaluar...';
      try {
        const res = await fetch('/setup/install-service', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          document.getElementById('service-badge').textContent = 'aktiv';
          document.getElementById('service-badge').className = 'badge badge-green';
          btn.textContent = 'Instaluar ✓';
        } else {
          btn.disabled = false;
          btn.textContent = 'Instalo Service';
          alert('Gabim: ' + (data.error || 'Duhet të ekzekutoni si Administrator.'));
        }
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Instalo Service';
        alert('Gabim: ' + e.message);
      }
    }

    function showStatus(type, title, msg) {
      const el = document.getElementById('status');
      el.className = 'status ' + type;
      el.style.display = 'block';
      document.getElementById('status-title').textContent = title;
      document.getElementById('status-msg').textContent = msg;
    }

    loadPorts();
  </script>
</body>
</html>`;

// ─── Setup Routes ─────────────────────────────────────────────────────────────

app.get("/setup", (req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(SETUP_HTML);
});

app.get("/setup/ports", async (req, res) => {
  try {
    const ports = await SerialPort.list();
    res.json({ ports });
  } catch (err) {
    res.json({ ports: [], error: err.message });
  }
});

app.post("/setup/save", async (req, res) => {
  const { port, brand, middleware, operatorId, operatorPassword } = req.body;
  const config = {
    ...loadConfig(),
    brand: brand || "datecs",
    middleware: middleware || brand || "datecs",
    port: port || "",
    operatorId: operatorId || "1",
    operatorPassword: operatorPassword || "0000",
    configured: true,
  };
  saveConfig(config);
  printer = null; // reset so next call uses new config

  // Test the connection
  let printerStatus = null;
  try {
    const p = getPrinter();
    printerStatus = await p.getStatus();
    res.json({ success: true, printerStatus });
  } catch (err) {
    // Config is saved even if the printer test fails — user can retry
    res.json({ success: false, error: err.message, printerStatus });
  }
});

app.post("/setup/install-service", (req, res) => {
  const exePath = process.execPath;
  // Use sc.exe to register the exe as a Windows service
  const createCmd = `sc create "Pako Bridge" binPath= "${exePath}" start= auto DisplayName= "Pako Fiscal Bridge"`;
  exec(createCmd, (err, _stdout, stderr) => {
    if (err) {
      return res.json({ success: false, error: stderr || err.message });
    }
    exec('sc start "Pako Bridge"', () => {});
    res.json({ success: true });
  });
});

// ─── Main Routes ──────────────────────────────────────────────────────────────

app.get("/status", async (req, res) => {
  try {
    const config = loadConfig();
    if (!config.configured) {
      return res.json({
        bridge: "ok",
        version: "1.0.0",
        configured: false,
        printer: { ok: false, statusText: "not configured" },
      });
    }
    const p = getPrinter();
    const status = await p.getStatus();
    res.json({
      bridge: "ok",
      version: "1.0.0",
      configured: true,
      printer: status,
      config: { brand: config.brand, middleware: config.middleware, port: config.port },
    });
  } catch (err) {
    res.json({
      bridge: "ok",
      version: "1.0.0",
      configured: true,
      printer: { ok: false, statusText: err.message },
    });
  }
});

app.post("/receipt", async (req, res) => {
  try {
    const p = getPrinter();
    const result = await p.printReceipt(req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/void-receipt", async (req, res) => {
  try {
    const p = getPrinter();
    const result = await p.voidReceipt();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/x-report", async (req, res) => {
  try {
    const p = getPrinter();
    const result = await p.xReport();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/z-report", async (req, res) => {
  try {
    const p = getPrinter();
    const result = await p.zReport();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/config", (req, res) => {
  try {
    res.json(loadConfig());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/config", (req, res) => {
  try {
    const config = { ...loadConfig(), ...req.body };
    saveConfig(config);
    printer = null;
    res.json({ success: true, config });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/paper-status", async (req, res) => {
  try {
    const p = getPrinter();
    const status = await p.getPaperStatus();
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const HOST = "127.0.0.1";
const PORT = 7878;

app.listen(PORT, HOST, () => {
  console.log(`[Pako Bridge] Running on http://${HOST}:${PORT}`);
  console.log(`[Pako Bridge] Config: ${CONFIG_PATH}`);

  const config = loadConfig();
  if (!config.configured) {
    console.log("[Pako Bridge] First run detected — opening setup page...");
    setTimeout(() => openBrowser(`http://${HOST}:${PORT}/setup`), 800);
  } else {
    console.log(`[Pako Bridge] Printer: ${config.brand} on ${config.port}`);
  }
});
