import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import type http from "node:http";
import { startStaticProxy } from "./offline.static-proxy";

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

function psql(sql: string) {
  execFileSync("docker", ["exec", pgContainer, "psql", "-U", "postgres", "-d", "postgres", "-c", sql], { stdio: "pipe" });
}

async function waitHealthy(url: string, child: ChildProcess) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API exited with code ${child.exitCode}`);
    try {
      const res = await fetch(`${url}/healthz`);
      if (res.ok) return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("API did not become healthy in 180s");
}

export default async function globalSetup() {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "pako-offline-"));
  const webroot = path.join(scratch, "wwwroot");
  const dist = path.join(scratch, "dist");
  const dbName = `pako_e2e_${randomBytes(4).toString("hex")}`;
  const secret = randomBytes(24).toString("hex");

  execFileSync("pnpm", ["exec", "vite", "build", "--outDir", dist, "--emptyOutDir"], {
    cwd: webRoot,
    env: { ...process.env, VITE_API_BASE_URL: "" },
    stdio: "inherit",
  });
  mkdirSync(webroot, { recursive: true });
  cpSync(dist, webroot, { recursive: true });

  psql(`CREATE DATABASE ${dbName}`);

  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(
    "dotnet",
    ["run", "--project", path.join(repoRoot, "backend/Pako.Api/Pako.Api.csproj"), "--no-launch-profile"],
    {
      cwd: repoRoot,
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
    },
  );

  let proxy: http.Server | null = null;
  const teardown = async () => {
    proxy?.close();
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 1500));
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    try {
      psql(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  };

  try {
    await waitHealthy(origin, child);
  } catch (err) {
    await teardown();
    throw err;
  }

  let browserOrigin = origin;
  const probe = await fetch(`${origin}/favicon.svg`);
  if (!(probe.headers.get("content-type") ?? "").includes("svg")) {
    console.warn(
      "WARNING: the API in Desktop mode does not serve static files from wwwroot (the SPA fallback shadows UseStaticFiles). " +
        "Serving the built web from a local static proxy that forwards /api to the API instead.",
    );
    const proxyPort = await freePort();
    proxy = await startStaticProxy(webroot, origin, proxyPort);
    browserOrigin = `http://127.0.0.1:${proxyPort}`;
  }

  process.env.PAKO_OFFLINE_ORIGIN = browserOrigin;
  process.env.PAKO_OFFLINE_SECRET = secret;
  return teardown;
}
