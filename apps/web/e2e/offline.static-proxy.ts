import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".png": "image/png",
};

export function startStaticProxy(root: string, apiOrigin: string, port: number): Promise<http.Server> {
  const api = new URL(apiOrigin);
  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (url.startsWith("/api") || url.startsWith("/hubs") || url.startsWith("/healthz")) {
      const upstream = http.request(
        { host: api.hostname, port: api.port, path: url, method: req.method, headers: { ...req.headers, host: api.host } },
        (upstreamRes) => {
          res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
          upstreamRes.pipe(res);
        },
      );
      upstream.on("error", () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
      return;
    }
    const pathname = decodeURIComponent(url.split("?")[0]);
    let file = path.join(root, pathname);
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) file = path.join(root, "index.html");
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
