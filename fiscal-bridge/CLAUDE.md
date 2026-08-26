# fiscal-bridge — Local fiscal printer bridge

Small Express service installed on the customer's Windows PC. Exposes a local HTTP API on `http://127.0.0.1:7878` that PAKO's backend/panel calls to print fiscal receipts on serial fiscal printers (Kosovo ATK devices). Ported essentially unchanged from `kudofatura-fiscal-bridge` (`/Users/erionavdiu/dev/kudofatura/kudofatura-fiscal-bridge/`) — working, hardware-tested code, no relationship to kudofatura's known security findings (it talks to a local printer, not to user auth). See `docs/ARCHITECTURE.md`'s repo-strategy-decision point 1 in the PAKO repo root.

## Stack

- Node 18, Express 4, `serialport` 12, `iconv-lite` (charset for printer), `node-windows` (Windows service install)
- Packaged into a single `dist/Pako-Bridge.exe` with `@yao-pkg/pkg` (target `node18-win-x64`); serialport native prebuilds are bundled via the `pkg.assets` config in package.json

## Commands

- `npm run dev` (nodemon) / `npm start`
- `npm run build:win` — builds the .exe, then `scripts/copy-natives.js` copies native bindings
- `npm run install-service` / `uninstall-service` — register as a Windows service (`install/windows-service.js`)

## Architecture

- `index.js` — entire HTTP server: loads/saves `config.json`, instantiates a printer driver, serves a browser `/setup` page (auto-opened on first run) for choosing COM port/brand. Endpoints: `GET /status`, `POST /receipt`, `POST /void-receipt`, `POST /x-report`, `POST /z-report`, `GET /config`, `PUT /config`, `GET /paper-status`.
- `lib/printers/` — drivers behind a common interface (`base-printer.js`): `datecs.js` (serial protocol, default), `tremol-zfplab.js`, `erpnet.js` (ErpNet middleware), `mock.js` for testing. Selected by `config.middleware`/`config.brand`.
- `lib/serial.js` — serial helpers; `lib/vat-groups.js` — Kosovo VAT group mapping.
- Config: `config.json` (brand, middleware, port, baudRate 115200, operatorId/operatorPassword). When running as the packaged .exe, config lives NEXT TO the .exe (pkg snapshot is read-only) — `index.js` resolves this via `process.pkg`.

## Distribution

- Not yet wired into a `Pako.Api` download endpoint (kudofatura's `KudoFatura-Bridge.zip` bundle was not carried over — build your own via `npm run build:win`). Bump `version` in package.json when shipping.

## Gotchas

- Fixed port 7878, bound to `127.0.0.1` only; browser CORS is wide open (`cors()`) — it is a localhost-only service, not internet-reachable.
- Testing without hardware: set `"middleware": "mock"` in config.json.
- `Pako.Domain/Fiscal/PefBridgeProvider` (backend C#) talks to this service over HTTP at `http://127.0.0.1:7878` — see `backend/Pako.Domain/Fiscal/`.
- Checked `/Users/erionavdiu/dev/kudofatura/SECURITY_AUDIT_REPORT.md` and `FRONTEND_AUDIT.md` before porting (2026-08-26): no finding in either document implicates this service's own code — the security report's findings are about Supabase/auth/frontend-role-enforcement in kudofatura's web stack, and the frontend audit's fiscal-printer section is about the *panel's* status-badge UI, not this bridge. Ported as-is.
