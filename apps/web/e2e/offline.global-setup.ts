import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

import { distAllowedHosts, listFiles, scanExternalUrls } from "../src/test/externalUrls";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webRoot, "../..");
const pgContainer = process.env.PAKO_E2E_PG_CONTAINER ?? "pako-postgres-1";
const pgPort = process.env.PAKO_E2E_PG_PORT ?? "5433";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

function psql(sql: string) {
  execFileSync("docker", ["exec", pgContainer, "psql", "-U", "postgres", "-d", "postgres", "-c", sql], { stdio: "pipe" });
}

function killGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

function groupAlive(pid: number) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitHealthy(url: string, child: ChildProcess) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API exited with code ${child.exitCode}`);
    try {
      const res = await fetch(`${url}/healthz`);
      if (res.ok) return;
    } catch {
      await sleep(500);
      continue;
    }
    await sleep(500);
  }
  throw new Error("API did not become healthy in 180s");
}

async function probeSpa(origin: string, secret: string, webroot: string) {
  const headers = { Cookie: `pako_launch=${secret}` };
  const root = await fetch(`${origin}/`, { headers });
  const rootType = root.headers.get("content-type") ?? "";
  console.log(`probe GET / -> ${root.status} ${rootType}`);
  if (root.status !== 200 || !rootType.includes("text/html")) throw new Error("API does not serve the SPA");

  const html = readFileSync(path.join(webroot, "index.html"), "utf8");
  const asset = html.match(/(?:src|href)="(\/assets\/[^"]+\.js)"/)?.[1];
  if (!asset) throw new Error("API does not serve the SPA: no /assets/*.js in the built index.html");
  const js = await fetch(`${origin}${asset}`, { headers });
  const jsType = js.headers.get("content-type") ?? "";
  console.log(`probe GET ${asset} -> ${js.status} ${jsType}`);
  if (js.status !== 200 || !/javascript/.test(jsType)) throw new Error("API does not serve the SPA");
}

export default async function globalSetup() {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "pako-offline-"));
  const webroot = path.join(scratch, "wwwroot");
  const dist = path.join(scratch, "dist");
  const dbName = `pako_e2e_${randomBytes(4).toString("hex")}`;
  const secret = randomBytes(24).toString("hex");
  let child: ChildProcess | null = null;
  let port: number | null = null;
  let dbCreated = false;

  const teardown = async () => {
    const problems: string[] = [];
    if (child?.pid) {
      const pid = child.pid;
      killGroup(pid, "SIGTERM");
      for (let i = 0; i < 20 && groupAlive(pid); i++) await sleep(500);
      if (groupAlive(pid)) {
        killGroup(pid, "SIGKILL");
        await sleep(500);
      }
      console.log(`teardown: API process group ${pid} alive=${groupAlive(pid)}`);
    }
    if (port !== null) {
      for (let i = 0; i < 10 && (await isListening(port)); i++) await sleep(500);
      const still = await isListening(port);
      console.log(`teardown: port ${port} listening=${still}`);
      if (still) problems.push(`port ${port} still listening after teardown`);
    }
    if (dbCreated) {
      try {
        psql(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
        console.log(`teardown: dropped ${dbName}`);
      } catch (err) {
        problems.push(`could not drop ${dbName}: ${String(err)}`);
      }
    }
    rmSync(scratch, { recursive: true, force: true });
    if (problems.length > 0) throw new Error(`teardown problems: ${problems.join("; ")}`);
  };

  try {
    execFileSync("pnpm", ["exec", "vite", "build", "--outDir", dist, "--emptyOutDir"], {
      cwd: webRoot,
      env: { ...process.env, VITE_API_BASE_URL: "" },
      stdio: "inherit",
    });

    const offenders = scanExternalUrls(listFiles({ roots: [dist] }), dist, distAllowedHosts);
    if (offenders.length > 0) throw new Error(`External URLs in built dist:\n${offenders.join("\n")}`);

    mkdirSync(webroot, { recursive: true });
    cpSync(dist, webroot, { recursive: true });

    psql(`CREATE DATABASE ${dbName}`);
    dbCreated = true;

    port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    child = spawn("dotnet", ["run", "--project", path.join(repoRoot, "backend/Pako.Api/Pako.Api.csproj"), "--no-launch-profile"], {
      cwd: repoRoot,
      detached: true,
      env: {
        ...process.env,
        ASPNETCORE_ENVIRONMENT: "Production",
        ASPNETCORE_URLS: origin,
        ASPNETCORE_WEBROOT: webroot,
        Desktop__Enabled: "true",
        Desktop__LaunchSecret: secret,
        ConnectionStrings__Default: `Host=127.0.0.1;Port=${pgPort};Database=${dbName};Username=postgres;Password=postgres`,
        Jwt__Key: randomBytes(32).toString("hex"),
        Email__Mode: "Log",
        Logging__LogLevel__Default: "Error",
        Logging__LogLevel__Microsoft: "Error",
      },
      stdio: "inherit",
    });
    console.log(`API pid ${child.pid} on ${origin}`);

    await waitHealthy(origin, child);
    await probeSpa(origin, secret, webroot);

    process.env.PAKO_OFFLINE_ORIGIN = origin;
    process.env.PAKO_OFFLINE_SECRET = secret;
  } catch (err) {
    try {
      await teardown();
    } catch (teardownErr) {
      console.error(String(teardownErr));
    }
    throw err;
  }
  return teardown;
}
