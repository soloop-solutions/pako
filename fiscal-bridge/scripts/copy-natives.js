/**
 * After pkg builds the exe, copy the native .node bindings next to it.
 * serialport's C++ bindings cannot be snapshotted by pkg — they must
 * sit alongside the exe on disk.
 *
 * The exe will find them via node-gyp-build's path resolution which
 * walks up from process.execPath.
 */

const fs = require("fs");
const path = require("path");

const DIST = path.join(__dirname, "..", "dist");
const PREBUILDS_SRC = path.join(__dirname, "..", "node_modules", "@serialport", "bindings-cpp", "prebuilds");
const PREBUILDS_DEST = path.join(DIST, "prebuilds");

if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });

copyDir(PREBUILDS_SRC, PREBUILDS_DEST);

console.log("[copy-natives] Prebuilt binaries copied to dist/prebuilds/");
console.log("[copy-natives] Ship dist/Pako-Bridge.exe + dist/prebuilds/ together.");

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`[copy-natives] Source not found: ${src}`);
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
