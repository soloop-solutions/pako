import { build } from 'esbuild'
import { copyFileSync, mkdirSync } from 'node:fs'
import nodePath from 'node:path'

const outDir = process.argv[2] ?? 'dist'

mkdirSync(outDir, { recursive: true })

await build({
  entryPoints: ['src/main.ts'],
  outfile: nodePath.join(outDir, 'main.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['electron'],
  banner: {
    js: "import { createRequire as __pakoCreateRequire } from 'node:module'; const require = __pakoCreateRequire(import.meta.url);",
  },
})

await build({
  entryPoints: ['src/preload.ts'],
  outfile: nodePath.join(outDir, 'preload.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
})

await build({
  entryPoints: ['src/setupPreload.ts'],
  outfile: nodePath.join(outDir, 'setupPreload.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
})

copyFileSync('src/splash.html', nodePath.join(outDir, 'splash.html'))
// Till mode: what this PC is, finding the main PC, and "can't reach the main PC".
copyFileSync('src/setup.html', nodePath.join(outDir, 'setup.html'))
copyFileSync('src/setup.js', nodePath.join(outDir, 'setup.js'))
