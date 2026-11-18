import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = path.resolve(__dirname, "../..");
const sharedSrc = path.resolve(webRoot, "../../packages/shared/src");

const roots = [path.join(webRoot, "src"), path.join(webRoot, "public"), path.join(webRoot, "index.html"), sharedSrc];
const skipDirs = new Set(["node_modules", "mocks", "test", "generated", "dist"]);
const scanned = /\.(ts|tsx|css|html|js|svg|json|webmanifest)$/;
const testFile = /\.test\.(ts|tsx)$/;
const urlPattern = /https?:\/\/[^\s"'`)<>\\]+/g;

const allowedHosts = [
  "www.w3.org",
  "w3.org",
  "purl.org",
  "schemas.microsoft.com",
  "schemas.openxmlformats.org",
  "react.dev",
  "reactjs.org",
  "example.com",
  "localhost",
  "127.0.0.1",
];

const allowedExact = [
  { file: "src/pages/distribution/RouteVisits.tsx", prefix: "https://www.google.com/maps?q=" },
  { file: "public/mockServiceWorker.js", prefix: "https://github.com/mswjs/msw" },
];

function collect(target: string, out: string[]) {
  const stat = statSync(target);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(target)) {
      if (skipDirs.has(entry)) continue;
      collect(path.join(target, entry), out);
    }
  } else if (scanned.test(target) && !testFile.test(target)) {
    out.push(target);
  }
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

describe("offline audit", () => {
  it("Build_ContainsNoExternalHttpUrls", () => {
    const files: string[] = [];
    roots.forEach((root) => collect(root, files));
    expect(files.length).toBeGreaterThan(50);

    const offenders: string[] = [];
    for (const file of files) {
      const relative = path.relative(webRoot, file).split(path.sep).join("/");
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(urlPattern)) {
        const url = match[0];
        if (allowedHosts.includes(hostOf(url))) continue;
        if (allowedExact.some((a) => relative.endsWith(a.file) && url.startsWith(a.prefix))) continue;
        offenders.push(`${relative}: ${url}`);
      }
    }
    expect(offenders, `External URLs found:\n${offenders.join("\n")}`).toEqual([]);
  });
});
