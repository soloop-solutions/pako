import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { VC_RUNTIME_DLLS, buildPaths, cscLinkIsPath, dotnetPublishArgs, planSteps, pnpmCommand, runSteps, signingEnv, vcRuntimeDir, webBuildEnv } from './build-desktop.mjs'

const root = path.join(path.sep, 'repo with space')
const paths = buildPaths(root)

function recorder({ failOn } = {}) {
  const calls = []
  const record = (entry) => {
    calls.push(entry)
    if (failOn && entry.includes(failOn)) throw new Error(`boom at ${failOn}`)
  }
  const run = async (command, args, opts) => record(`run ${command} ${args.join(' ')} @${path.relative(root, opts.cwd) || '.'}${opts.env.VITE_API_BASE_URL === '' ? ' VITE_API_BASE_URL=""' : ''}`)
  const files = {
    remove: async (p) => record(`remove ${path.relative(root, p)}`),
    copyDir: async (from, to) => record(`copy ${path.relative(root, from)} -> ${path.relative(root, to)}`),
    requireFile: async (p) => record(`require ${path.relative(root, p)}`),
    copyFile: async (from, to) => record(`copyFile ${from} -> ${path.relative(root, to)}`),
  }
  const fetchPg = async ({ outDir }) => record(`fetch-postgres ${path.relative(root, outDir)}`)
  return { calls, run, files, fetchPg }
}

const env = { PATH: '/bin', npm_execpath: '/pnpm/bin/pnpm.cjs', PAKO_VCRUNTIME_DIR: '/crt' }

test('Build_RunsStepsInOrder', async () => {
  const r = recorder()
  await runSteps(planSteps({ paths, env, run: r.run, files: r.files, fetchPg: r.fetchPg, log: () => {} }), () => {})

  const api = path.join('apps', 'desktop', 'resources', 'api')
  assert.deepEqual(r.calls, [
    `remove ${api}`,
    `run dotnet publish ${paths.apiProject} -r win-x64 --self-contained -c Release -o ${paths.apiOut} @.`,
    `require ${path.join(api, 'Pako.Api.exe')}`,
    `run ${process.execPath} /pnpm/bin/pnpm.cjs --filter web exec vite build @. VITE_API_BASE_URL=""`,
    `require ${path.join('apps', 'web', 'dist', 'index.html')}`,
    `remove ${path.join(api, 'wwwroot')}`,
    `copy ${path.join('apps', 'web', 'dist')} -> ${path.join(api, 'wwwroot')}`,
    `fetch-postgres ${path.join('apps', 'desktop', 'resources', 'pg')}`,
    ...['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll'].map(
      (dll) => `copyFile ${path.join('/crt', dll)} -> ${path.join('apps', 'desktop', 'resources', 'pg', 'bin', dll)}`,
    ),
    `run ${process.execPath} /pnpm/bin/pnpm.cjs --filter @pako/desktop build @.`,
    `run ${process.execPath} /pnpm/bin/pnpm.cjs exec electron-builder --win nsis --x64 --publish never --config electron-builder.yml @${path.join('apps', 'desktop')}`,
  ])
})

test('Build_FailsFast_NamingTheStep', async () => {
  const r = recorder({ failOn: '--filter web exec vite build' })
  await assert.rejects(
    runSteps(planSteps({ paths, env, run: r.run, files: r.files, fetchPg: r.fetchPg, log: () => {} }), () => {}),
    /step "build web \(VITE_API_BASE_URL=""\)" failed: boom/,
  )
  assert.equal(r.calls.some((c) => c.startsWith('copy') || c.startsWith('fetch-postgres') || c.includes('electron-builder')), false)
})

test('Build_PublishArgs_AreSelfContainedWinX64Release', () => {
  assert.deepEqual(dotnetPublishArgs(paths).slice(0, 7), [
    'publish',
    path.join(root, 'backend', 'Pako.Api', 'Pako.Api.csproj'),
    '-r',
    'win-x64',
    '--self-contained',
    '-c',
    'Release',
  ])
})

test('Build_WebEnv_SetsEmptyApiBaseUrl_WithoutMutatingInput', () => {
  const input = { VITE_API_BASE_URL: 'http://127.0.0.1:5248', X: '1' }
  assert.deepEqual(webBuildEnv(input), { VITE_API_BASE_URL: '', X: '1' })
  assert.equal(input.VITE_API_BASE_URL, 'http://127.0.0.1:5248')
})

test('Build_Signing_SkipsWithLoudWarning_WhenNoCertificate', () => {
  const unsigned = signingEnv({ PATH: '/bin' })
  assert.match(unsigned.warning, /NOT be signed/)
  assert.equal(unsigned.env.CSC_IDENTITY_AUTO_DISCOVERY, 'false')

  const signed = signingEnv({ WIN_CSC_LINK: 'C:\\certs\\pako.pfx', WIN_CSC_KEY_PASSWORD: 'pw' })
  assert.equal(signed.warning, null)
  assert.equal(signed.env.WIN_CSC_LINK, 'C:\\certs\\pako.pfx')

  assert.throws(() => signingEnv({ WIN_CSC_LINK: 'C:\\certs\\pako.pfx' }), /WIN_CSC_KEY_PASSWORD/)
})

test('Build_SignedBuild_RequiresTheCertificateFile', async () => {
  const r = recorder()
  const signedEnv = { ...env, WIN_CSC_LINK: '/certs/pako.pfx', WIN_CSC_KEY_PASSWORD: 'pw' }
  const steps = planSteps({ paths, env: signedEnv, run: r.run, files: r.files, fetchPg: r.fetchPg, log: () => {} })
  await steps.at(-1).run()
  assert.deepEqual(r.calls.slice(0, 1), [`require ${path.relative(root, '/certs/pako.pfx')}`])
})

test('Build_PnpmCommand_UsesTheRunningPnpm', () => {
  assert.deepEqual(pnpmCommand({ npm_execpath: '/x/pnpm.cjs' }, '/node'), { command: '/node', prefix: ['/x/pnpm.cjs'] })
  assert.deepEqual(pnpmCommand({}, '/node'), { command: 'pnpm', prefix: [] })
  assert.deepEqual(pnpmCommand({ npm_execpath: '/x/npm-cli.js' }, '/node'), { command: 'pnpm', prefix: [] })
})

test('Build_VcRuntime_ComesFromEnvironment_OrFailsBeforeAnyWork', async () => {
  assert.deepEqual(VC_RUNTIME_DLLS, ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll'])
  assert.equal(vcRuntimeDir({ PAKO_VCRUNTIME_DIR: '/crt' }), '/crt')
  assert.equal(
    vcRuntimeDir({ VCToolsRedistDir: 'C:/VS/VC/Redist/MSVC/14.40.33807/' }),
    path.join('C:/VS/VC/Redist/MSVC/14.40.33807/', 'x64', 'Microsoft.VC143.CRT'),
  )
  assert.equal(vcRuntimeDir({}), null)

  const r = recorder()
  const { PAKO_VCRUNTIME_DIR, ...noRuntime } = env
  assert.throws(
    () => planSteps({ paths, env: noRuntime, run: r.run, files: r.files, fetchPg: r.fetchPg, log: () => {} }),
    /PAKO_VCRUNTIME_DIR/,
  )
  assert.deepEqual(r.calls, [])
})

test('Build_CscLink_OnlyAPathIsCheckedOnDisk', async () => {
  assert.equal(cscLinkIsPath('C:\\certs\\pako.pfx'), true)
  assert.equal(cscLinkIsPath('/certs/pako.p12'), true)
  assert.equal(cscLinkIsPath('./pako.pfx'), true)
  assert.equal(cscLinkIsPath('https://vault.example/pako.pfx'), false)
  assert.equal(cscLinkIsPath('MIIKcQIBAzCCCjcGCSqGSIb3DQEHAaCCCigEggokMIIKIDCCBNcGCSqGSIb3DQEHBqCCBMgw/+abc=='), false)

  const r = recorder()
  const base64Env = { ...env, WIN_CSC_LINK: 'MIIKcQIBAzCCCjcGCSqGSIb3DQEHAa/+==', WIN_CSC_KEY_PASSWORD: 'pw' }
  await planSteps({ paths, env: base64Env, run: r.run, files: r.files, fetchPg: r.fetchPg, log: () => {} }).at(-1).run()
  assert.equal(r.calls.some((c) => c.startsWith('require')), false)
  assert.equal(r.calls.length, 1)
})
