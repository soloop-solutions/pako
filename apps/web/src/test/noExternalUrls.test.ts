import path from "node:path";
import { describe, expect, it } from "vitest";

import { listFiles, scanExternalUrls, sourcePolicy } from "./externalUrls";

const webRoot = path.resolve(__dirname, "../..");
const sharedSrc = path.resolve(webRoot, "../../packages/shared/src");

describe("offline audit", () => {
  it("Build_ContainsNoExternalHttpUrls", () => {
    const files = [
      ...listFiles({ roots: [path.join(webRoot, "src")], topLevelSkipDirs: ["test", "mocks", "generated"], skipTests: true }),
      ...listFiles({ roots: [path.join(webRoot, "public"), path.join(webRoot, "index.html")] }),
      ...listFiles({ roots: [sharedSrc], topLevelSkipDirs: ["generated"], skipTests: true }),
    ];
    expect(files.length).toBeGreaterThan(50);

    const offenders = scanExternalUrls(files, webRoot, sourcePolicy);
    expect(offenders, `External URLs found:\n${offenders.join("\n")}`).toEqual([]);
  });
});
