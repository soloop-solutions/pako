import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const absolutePattern = /\b(?:https?|wss?):\/\/[^\s"'`)<>\\]+/gi;
const dottedProtocolRelativePattern = /(?<![:\w/.\\])\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:[/:?#][^\s"'`)<>\\]*)?/gi;
const bareProtocolRelativePattern = /(?<=["'`(=])\/\/([a-z0-9-]+)\/[^\s"'`)<>\\]+/gi;
const templatedIpv6 = /^[a-z]+:\/\/\[\$\{/i;

export const namespaceHosts = [
  "www.w3.org",
  "w3.org",
  "purl.org",
  "purl.oclc.org",
  "schemas.microsoft.com",
  "schemas.openxmlformats.org",
  "openoffice.org",
  "docs.oasis-open.org",
  "localhost",
  "127.0.0.1",
  "[::1]",
  "example.com",
];

export type AllowRule = { prefix: string; file: RegExp };
export type Policy = { hosts: string[]; rules: AllowRule[] };

const indexChunk = /^assets\/index-[\w-]+\.js$/;

export const sourcePolicy: Policy = {
  hosts: namespaceHosts,
  rules: [
    { prefix: "https://www.google.com/maps?q=", file: /(^|\/)RouteVisits\.tsx$/ },
    { prefix: "https://github.com/mswjs/msw", file: /(^|\/)mockServiceWorker\.js$/ },
  ],
};

export const distPolicy: Policy = {
  hosts: namespaceHosts,
  rules: [
    { prefix: "https://www.google.com/maps?q=", file: /^assets\/RouteVisits-[\w-]+\.js$/ },
    { prefix: "https://github.com/mswjs/msw", file: /^mockServiceWorker\.js$/ },
    { prefix: "https://react.dev/errors/", file: indexChunk },
    { prefix: "https://reactrouter.com/en/main/routers/picking-a-router", file: indexChunk },
    { prefix: "https://github.com/ungap/url-search-params", file: indexChunk },
    { prefix: "https://formatjs.github.io/docs/", file: indexChunk },
    { prefix: "https://github.com/date-fns/date-fns/blob/master/docs/unicodeTokens.md", file: indexChunk },
    { prefix: "https://json-schema.org/draft/2020-12/schema", file: indexChunk },
    { prefix: "http://json-schema.org/draft-07/schema#", file: indexChunk },
    { prefix: "http://json-schema.org/draft-04/schema#", file: indexChunk },
    { prefix: "http://macVmlSchemaUri", file: /^assets\/exportToExcel-[\w-]+\.js$/ },
    { prefix: "https://learn.microsoft.com/aspnet/core/signalr/javascript-client", file: /^assets\/pos-hub-[\w-]+\.js$/ },
    { prefix: "https://aka.ms/signalr-core-differences", file: /^assets\/pos-hub-[\w-]+\.js$/ },
  ],
};

export type ListOptions = {
  roots: string[];
  topLevelSkipDirs?: string[];
  skipTests?: boolean;
};

const scannedExtensions = /\.(ts|tsx|css|html|js|mjs|svg|json|webmanifest)$/;

function hostOf(url: string) {
  const bare = url.replace(/\$\{[^}]*\}/g, "/");
  try {
    return new URL(bare).hostname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function collect(target: string, options: ListOptions, topLevel: boolean, out: string[]) {
  const stat = statSync(target);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(target)) {
      if (entry === "node_modules") continue;
      if (topLevel && options.topLevelSkipDirs?.includes(entry)) continue;
      collect(path.join(target, entry), options, false, out);
    }
  } else if (scannedExtensions.test(target)) {
    if (options.skipTests && /\.test\.(ts|tsx)$/.test(target)) return;
    out.push(target);
  }
}

export function listFiles(options: ListOptions) {
  const files: string[] = [];
  for (const root of options.roots) collect(root, options, true, files);
  return files;
}

export function scanText(text: string, relative: string, policy: Policy) {
  const offenders: string[] = [];
  const allowedByRule = (url: string) => policy.rules.some((rule) => url.startsWith(rule.prefix) && rule.file.test(relative));
  for (const match of text.matchAll(absolutePattern)) {
    const url = match[0];
    if (templatedIpv6.test(url)) continue;
    if (policy.hosts.includes(hostOf(url))) continue;
    if (allowedByRule(url)) continue;
    offenders.push(`${relative}: ${url}`);
  }
  for (const pattern of [dottedProtocolRelativePattern, bareProtocolRelativePattern]) {
    for (const match of text.matchAll(pattern)) {
      if (policy.hosts.includes(match[1].toLowerCase())) continue;
      offenders.push(`${relative}: ${match[0]}`);
    }
  }
  return offenders;
}

export function scanExternalUrls(files: string[], base: string, policy: Policy) {
  return files.flatMap((file) => scanText(readFileSync(file, "utf8"), path.relative(base, file).split(path.sep).join("/"), policy));
}

export function assertScanCoverage(files: string[], label: string) {
  if (files.length === 0) throw new Error(`Scan of ${label} scanned 0 files`);
  if (!files.some((file) => path.basename(file) === "index.html")) {
    throw new Error(`Scan of ${label} scanned ${files.length} files but found no index.html`);
  }
  if (!files.some((file) => file.endsWith(".js"))) {
    throw new Error(`Scan of ${label} scanned ${files.length} files but found no .js file`);
  }
}
