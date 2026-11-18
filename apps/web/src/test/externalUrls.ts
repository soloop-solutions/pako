import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const absolutePattern = /https?:\/\/[^\s"'`)<>\\]+/g;
const protocolRelativePattern = /(?<![:\w/.\\])\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:[/:?#][^\s"'`)<>\\]*)?/gi;

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
];

export const sourceAllowedHosts = [...namespaceHosts, "react.dev", "reactjs.org", "example.com"];

export const distAllowedHosts = [
  ...sourceAllowedHosts,
  "reactrouter.com",
  "formatjs.github.io",
  "github.com",
  "learn.microsoft.com",
  "aka.ms",
  "json-schema.org",
  "macvmlschemauri",
];

export const allowedExactUrls = ["https://www.google.com/maps?q=", "https://github.com/mswjs/msw"];

export type ListOptions = {
  roots: string[];
  topLevelSkipDirs?: string[];
  skipTests?: boolean;
};

const scannedExtensions = /\.(ts|tsx|css|html|js|mjs|svg|json|webmanifest)$/;

function hostOf(url: string) {
  const bare = url.replace(/\$\{[^}]*\}/g, "/");
  if (/^https?:\/\/\[/.test(bare)) return "127.0.0.1";
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

export function scanExternalUrls(files: string[], base: string, allowedHosts: string[]) {
  const offenders: string[] = [];
  for (const file of files) {
    const relative = path.relative(base, file).split(path.sep).join("/");
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(absolutePattern)) {
      const url = match[0];
      if (allowedHosts.includes(hostOf(url))) continue;
      if (allowedExactUrls.some((prefix) => url.startsWith(prefix))) continue;
      offenders.push(`${relative}: ${url}`);
    }
    for (const match of text.matchAll(protocolRelativePattern)) {
      if (allowedHosts.includes(match[1].toLowerCase())) continue;
      offenders.push(`${relative}: ${match[0]}`);
    }
  }
  return offenders;
}
