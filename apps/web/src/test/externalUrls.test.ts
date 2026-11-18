import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { assertScanCoverage, distPolicy, listFiles, scanText, sourcePolicy } from "./externalUrls";
import { findForeignUrls } from "./sameOrigin";

const flagged = (text: string, policy = sourcePolicy, file = "src/x.ts") => scanText(text, file, policy);

describe("external URL scanner", () => {
  it("Scanner_FlagsWebsocketUrls", () => {
    expect(flagged('const s = new WebSocket("ws://evil.test");')).toHaveLength(1);
    expect(flagged('const u = "wss://evil.test/s";')).toHaveLength(1);
  });

  it("Scanner_IsCaseInsensitiveOnScheme", () => {
    expect(flagged('const u = "HTTPS://EVIL.TEST/x";')).toHaveLength(1);
    expect(flagged('const u = "Wss://evil.test/x";')).toHaveLength(1);
  });

  it("Scanner_FlagsNonLoopbackIpv6_AllowsLoopbackIpv6", () => {
    expect(flagged('const u = "http://[2001:db8::1]/x";')).toHaveLength(1);
    expect(flagged('const u = "http://[::1]:5000/x";')).toEqual([]);
  });

  it("Scanner_FlagsProtocolRelativeBareHosts", () => {
    expect(flagged('<script src="//cdn/x.js"></script>')).toHaveLength(1);
    expect(flagged("background: url(//cdn/x.png)")).toHaveLength(1);
    expect(flagged('const u = "//fonts.gstatic.com/s/inter.woff2";')).toHaveLength(1);
  });

  it("Scanner_StillIgnoresPreviousFalsePositives", () => {
    expect(flagged("const a = `http://[${t.value}]`; const b = `http://[${r}]`;")).toEqual([]);
    expect(flagged("const c = `http://127.0.0.1:5248${e}`;")).toEqual([]);
    expect(flagged("const d = /^https?:\\/\\//i.test(url);")).toEqual([]);
    expect(flagged("const e = `//${host}/x`; // a comment\nconst f = 1; //note")).toEqual([]);
  });

  it("Scanner_NoLongerAllowsWholesaleDocHosts", () => {
    expect(flagged('"https://github.com/evil/x.js"', distPolicy, "assets/index-abc.js")).toHaveLength(1);
    expect(flagged('"https://aka.ms/x"', distPolicy, "assets/index-abc.js")).toHaveLength(1);
    expect(flagged('"https://formatjs.github.io/evil.js"', distPolicy, "assets/other.js")).toHaveLength(1);
  });

  it("Scanner_BindsExactUrlsToFiles", () => {
    const maps = "https://www.google.com/maps?q=${a},${b}";
    expect(flagged(maps, sourcePolicy, "src/pages/distribution/RouteVisits.tsx")).toEqual([]);
    expect(flagged(maps, sourcePolicy, "src/pages/Other.tsx")).toHaveLength(1);
    expect(flagged(maps, distPolicy, "assets/RouteVisits-C56TY6d1.js")).toEqual([]);
    expect(flagged(maps, distPolicy, "assets/index-C56TY6d1.js")).toHaveLength(1);
    const msw = "https://github.com/mswjs/msw";
    expect(flagged(msw, sourcePolicy, "public/mockServiceWorker.js")).toEqual([]);
    expect(flagged(msw, sourcePolicy, "src/main.tsx")).toHaveLength(1);
    expect(flagged(msw, distPolicy, "mockServiceWorker.js")).toEqual([]);
  });

  it("Scanner_AllowsNamespaceUrls", () => {
    expect(flagged('xmlns="http://www.w3.org/2000/svg" x="http://schemas.openxmlformats.org/a"', distPolicy, "assets/a.js")).toEqual([]);
  });
});

describe("scan coverage guard", () => {
  it("ScanCoverage_RejectsEmptyDirectory", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pako-empty-"));
    try {
      const files = listFiles({ roots: [dir] });
      expect(files).toEqual([]);
      expect(() => assertScanCoverage(files, dir)).toThrow(/scanned 0 files/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ScanCoverage_RequiresIndexHtmlAndJs", () => {
    expect(() => assertScanCoverage(["/d/assets/a.js"], "/d")).toThrow(/index\.html/);
    expect(() => assertScanCoverage(["/d/index.html"], "/d")).toThrow(/\.js/);
    expect(() => assertScanCoverage(["/d/index.html", "/d/assets/a.js"], "/d")).not.toThrow();
  });
});

describe("same-origin check", () => {
  const origin = "http://127.0.0.1:5000";

  it("SameOrigin_AcceptsApiOriginAndLocalSchemes", () => {
    expect(findForeignUrls([`${origin}/api/x`, "ws://127.0.0.1:5000/hubs/pos", "data:text/plain,a", "blob:http://127.0.0.1:5000/abc"], origin)).toEqual([]);
  });

  it("SameOrigin_RejectsOtherHostsPortsSchemesAndUserinfoTricks", () => {
    const bad = [
      "http://evil.test/x",
      "ws://evil.test/s",
      "wss://evil.test/s",
      "http://127.0.0.1:5001/x",
      "ws://127.0.0.1:5001/x",
      "http://127.0.0.1:5000@evil.test/",
      "https://127.0.0.1:5000/x",
      "wss://127.0.0.1:5000/x",
      "not a url",
    ];
    expect(findForeignUrls(bad, origin)).toEqual(bad);
  });
});
