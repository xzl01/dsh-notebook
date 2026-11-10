#!/usr/bin/env node
/**
 * Vault auto-detection test for index.js.
 *
 * `detectObsidianVault()` reads Obsidian's own recent-vault list from the
 * platform config directory. This test points HOME (and APPDATA on Windows) at
 * a temporary tree and checks the three behaviours that matter:
 *
 *   - the open vault wins over a newer closed one;
 *   - a broken config file falls through to the next candidate location;
 *   - no Obsidian config at all yields null instead of throwing.
 *
 * Run: node test/host-vault-detect.mjs
 */

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promises as fsp } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const WORKSPACE = dirname(TEST_DIR)
const ROOT = join(TEST_DIR, '.tmp-detect')
const HOME = join(ROOT, 'home')
const OPEN_VAULT = join(ROOT, 'vaults', 'open-vault')
const CLOSED_VAULT = join(ROOT, 'vaults', 'closed-vault')
const XDG_VAULT = join(ROOT, 'vaults', 'xdg-vault')

let passed = 0
let failed = 0
const failures = []

async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS  ${name}`)
  } catch (error) {
    failed += 1
    const detail = error instanceof Error ? error.message || error.stack : String(error)
    failures.push({ name, detail })
    console.log(`FAIL  ${name}`)
    console.log(`      ${detail.replace(/\n/g, '\n      ')}`)
  }
}

/** The same locations index.js probes, written independently on purpose. */
function configPaths(home) {
  const paths = []
  if (process.platform === 'darwin') {
    paths.push(join(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json'))
  } else if (process.platform === 'win32') {
    paths.push(join(home, 'AppData', 'Roaming', 'obsidian', 'obsidian.json'))
  } else {
    paths.push(join(home, '.config', 'obsidian', 'obsidian.json'))
  }
  return paths
}

const XDG_PATH = join(HOME, '.config', 'obsidian', 'obsidian.json')
const PRIMARY_PATH = configPaths(HOME)[0]

async function writeConfig(path, record) {
  await fsp.mkdir(dirname(path), { recursive: true })
  await fsp.writeFile(path, JSON.stringify(record), 'utf8')
}

/** Run the plugin's detector in a child process rooted at the temporary home. */
async function detect() {
  const entry = pathToFileURL(join(WORKSPACE, 'index.js')).href
  const script = `import(${JSON.stringify(entry)}).then((m) => process.stdout.write(String(m.detectObsidianVault())))`
  const env = { ...process.env, HOME, USERPROFILE: HOME }
  if (process.platform === 'win32') env.APPDATA = join(HOME, 'AppData', 'Roaming')
  const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script], { env })
  return stdout.trim()
}

async function main() {
  const resolvedRoot = (await fsp.realpath(TEST_DIR)).replace(/\/$/, '')
  if (!ROOT.startsWith(resolvedRoot + sep)) throw new Error(`unsafe temp path: ${ROOT}`)
  await fsp.rm(ROOT, { recursive: true, force: true })
  await fsp.mkdir(OPEN_VAULT, { recursive: true })
  await fsp.mkdir(CLOSED_VAULT, { recursive: true })
  await fsp.mkdir(XDG_VAULT, { recursive: true })

  await check('an open vault wins over a newer closed one', async () => {
    await writeConfig(PRIMARY_PATH, {
      vaults: {
        a: { path: OPEN_VAULT, ts: 1000, open: true },
        b: { path: CLOSED_VAULT, ts: 9999 },
      },
    })
    assert.equal(await detect(), OPEN_VAULT)
  })

  await check('the most recently used vault wins when nothing is open', async () => {
    await writeConfig(PRIMARY_PATH, {
      vaults: {
        a: { path: OPEN_VAULT, ts: 1000 },
        b: { path: CLOSED_VAULT, ts: 9999 },
      },
    })
    assert.equal(await detect(), CLOSED_VAULT)
  })

  await check('a broken config file falls through to the next candidate', async () => {
    await fsp.writeFile(PRIMARY_PATH, '{ not json', 'utf8')
    await writeConfig(XDG_PATH, { vaults: { x: { path: XDG_VAULT, ts: 1, open: true } } })
    assert.equal(await detect(), XDG_VAULT)
  })

  await check('no Obsidian config at all yields null', async () => {
    await fsp.rm(join(HOME, 'Library'), { recursive: true, force: true })
    await fsp.rm(join(HOME, 'AppData'), { recursive: true, force: true })
    await fsp.rm(join(HOME, '.config'), { recursive: true, force: true })
    assert.equal(await detect(), 'null')
  })

  await fsp.rm(ROOT, { recursive: true, force: true })
}

await main()

console.log('')
if (failures.length > 0) {
  console.log('Failures:')
  for (const failure of failures) console.log(`  - ${failure.name}: ${failure.detail}`)
}
console.log(`SUMMARY: ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
