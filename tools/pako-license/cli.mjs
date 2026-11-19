#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { formatPublicKeyArray, issueLicense, keygen } from './lib.mjs'

const USAGE = `Usage:
  pako-license keygen --out <dir> [--force]
  pako-license issue --private-key <file> --machine <XXXX-XXXX-XXXX-XXXX> --customer <name> [--expires <YYYY-MM-DD | ISO date-time>]`

function run(argv) {
  const [command, ...rest] = argv
  if (command === 'keygen') {
    const { values } = parseArgs({ args: rest, options: { out: { type: 'string' }, force: { type: 'boolean' } } })
    if (!values.out) throw new Error('--out is required')
    const { privatePath, publicPath, raw } = keygen({ outDir: values.out, force: values.force })
    process.stderr.write(
      `Private key: ${privatePath}\nPublic key:  ${publicPath}\n` +
        'Keep the private key off any repository and back it up offline. Paste this into backend/Pako.Domain/Desktop/LicensePublicKey.cs:\n',
    )
    process.stdout.write(`${formatPublicKeyArray(raw)}\n`)
    return
  }
  if (command === 'issue') {
    const { values } = parseArgs({
      args: rest,
      options: {
        'private-key': { type: 'string' },
        machine: { type: 'string' },
        customer: { type: 'string' },
        expires: { type: 'string' },
      },
    })
    if (!values['private-key']) throw new Error('--private-key is required')
    if (!values.machine) throw new Error('--machine is required')
    if (!values.customer) throw new Error('--customer is required')
    const key = issueLicense({
      privateKeyPem: readFileSync(values['private-key'], 'utf8'),
      machine: values.machine,
      customer: values.customer,
      expires: values.expires,
      now: new Date(),
    })
    process.stdout.write(`${key}\n`)
    return
  }
  throw new Error(USAGE)
}

try {
  run(process.argv.slice(2))
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
}
