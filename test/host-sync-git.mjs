#!/usr/bin/env node
/**
 * git sync engine test.
 *
 * Builds a bare repository and two vaults that both sync to it, so the real
 * path is exercised: init, first commit, push, pull/rebase, conflict detection,
 * and a local-only repository with no remote.
 *
 * Run: node test/host-sync-git.mjs
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { promises as fsp } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const WORKSPACE = dirname(TEST_DIR)
const ROOT = join(TEST_DIR, '.tmp-sync-git')
const REMOTE = join(ROOT, 'remote.git')
const VAULT_A = join(ROOT, 'vault-a')
const VAULT_B = join(ROOT, 'vault-b')
const VAULT_C = join(ROOT, 'vault-c')

const { createSyncService } = await import(join(WORKSPACE, 'sync.js'))

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Sync Test',
  GIT_AUTHOR_EMAIL: 'sync-test@example.com',
  GIT_COMMITTER_NAME: 'Sync Test',
  GIT_COMMITTER_EMAIL: 'sync-test@example.com',
  GIT_TERMINAL_PROMPT: '0',
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function gitQuiet(cwd, args) {
  try {
    return git(cwd, args)
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------------- */
/* Check harness                                                             */
/* ------------------------------------------------------------------------- */

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
    failures.push({ name, error })
    const detail = error instanceof Error ? (error.message || error.stack) : String(error)
    console.log(`FAIL  ${name}\n      ${detail.split('\n').join('\n      ')}`)
  }
}

async function write(vault, rel, text) {
  const abs = join(vault, rel)
  await fsp.mkdir(dirname(abs), { recursive: true })
  await fsp.writeFile(abs, text, 'utf8')
}

async function read(vault, rel) {
  return fsp.readFile(join(vault, rel), 'utf8')
}

async function exists(path) {
  try {
    await fsp.stat(path)
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------------- */
/* Setup                                                                     */
/* ------------------------------------------------------------------------- */

await fsp.rm(ROOT, { recursive: true, force: true })
await fsp.mkdir(ROOT, { recursive: true })
for (const vault of [VAULT_A, VAULT_B, VAULT_C]) await fsp.mkdir(vault, { recursive: true })
execFileSync('git', ['init', '--bare', '--initial-branch=main', REMOTE], { env: GIT_ENV, stdio: 'ignore' })

await write(VAULT_A, '笔记/甲.md', '# 甲\n\nA 端第一篇。\n')
const serviceA = createSyncService({ root: VAULT_A })
const serviceB = createSyncService({ root: VAULT_B })
const serviceC = createSyncService({ root: VAULT_C })

/* ------------------------------------------------------------------------- */
/* Scenario                                                                  */
/* ------------------------------------------------------------------------- */

await check('git settings are stored outside the repository worktree', async () => {
  await serviceA.saveSettings({
    provider: 'git',
    git: { remote: REMOTE, branch: 'main' },
    auto: { onSave: false, intervalMinutes: 0 },
  })
  const raw = JSON.parse(await fsp.readFile(serviceA.settingsPath, 'utf8'))
  assert.equal(raw.provider, 'git')
  assert.equal(raw.git.remote, REMOTE)
})

await check('test connection reports git and a remote without the branch yet', async () => {
  const probe = await serviceA.testConnection()
  assert.equal(probe.ok, true)
  assert.equal(probe.provider, 'git')
  assert.equal(probe.repository, false)
  assert.equal(probe.remoteBranch, false)
})

await check('first sync initializes the repository, commits and creates the remote branch', async () => {
  const result = await serviceA.run({ trigger: 'manual' })
  assert.equal(result.ok, true, JSON.stringify(result.error))
  assert.equal(result.committed, 1, `expected one changed file, got ${result.committed}`)
  assert.equal(result.pushed, 1)
  const branch = git(REMOTE, ['rev-parse', '--verify', 'refs/heads/main'])
  assert.match(branch, /^[0-9a-f]{40}$/)
  assert.equal(git(REMOTE, ['show', 'main:笔记/甲.md']), '# 甲\n\nA 端第一篇。')
})

await check('the sync manifest and settings never enter a commit', async () => {
  const tracked = git(VAULT_A, ['ls-files'])
  assert.equal(tracked.includes('.dsh-notebook'), false, `tracked: ${tracked}`)
  const exclude = await fsp.readFile(join(VAULT_A, '.git', 'info', 'exclude'), 'utf8')
  assert.match(exclude, /^\.dsh-notebook\/$/m)
  const status = git(VAULT_A, ['status', '--porcelain'])
  assert.equal(status.includes('.dsh-notebook'), false, `status: ${status}`)
})

await check('a second vault pulls the remote history before pushing its own commit', async () => {
  await write(VAULT_B, '笔记/乙.md', '# 乙\n\nB 端第一篇。\n')
  await serviceB.saveSettings({ provider: 'git', git: { remote: REMOTE, branch: 'main' } })
  const result = await serviceB.run({ trigger: 'manual' })
  assert.equal(result.ok, true, JSON.stringify(result.error))
  assert.equal(result.pulled, 1, `expected to replay the remote commit, pulled=${result.pulled}`)
  assert.equal(result.pushed, 1)
  assert.equal(git(REMOTE, ['show', 'main:笔记/乙.md']), '# 乙\n\nB 端第一篇。')
  assert.equal(git(REMOTE, ['show', 'main:笔记/甲.md']), '# 甲\n\nA 端第一篇。')
})

await check('the first vault then downloads the other commit', async () => {
  const result = await serviceA.run({ trigger: 'manual' })
  assert.equal(result.ok, true, JSON.stringify(result.error))
  assert.equal(result.pulled, 1)
  assert.equal(result.pushed, 0)
  assert.equal(await read(VAULT_A, '笔记/乙.md'), '# 乙\n\nB 端第一篇。\n')
})

await check('a deletion is committed and reaches the other vault', async () => {
  await fsp.rm(join(VAULT_B, '笔记/乙.md'))
  const removed = await serviceB.run({ trigger: 'manual' })
  assert.equal(removed.ok, true, JSON.stringify(removed.error))
  assert.equal(removed.committed, 1)
  assert.equal(gitQuiet(REMOTE, ['show', 'main:笔记/乙.md']), null, 'remote still has the deleted note')
  const pulled = await serviceA.run({ trigger: 'manual' })
  assert.equal(pulled.ok, true, JSON.stringify(pulled.error))
  assert.equal(await exists(join(VAULT_A, '笔记/乙.md')), false)
})

await check('conflicting edits are reported as git_conflict and leave no half-finished rebase', async () => {
  await write(VAULT_A, '笔记/甲.md', '# 甲\n\nA 端改了这一行。\n')
  const pushed = await serviceA.run({ trigger: 'manual' })
  assert.equal(pushed.ok, true, JSON.stringify(pushed.error))
  assert.equal(pushed.pushed, 1)

  await write(VAULT_B, '笔记/甲.md', '# 甲\n\nB 端也改了这一行。\n')
  await assert.rejects(serviceB.run({ trigger: 'manual' }), (error) => {
    assert.equal(error.code, 'git_conflict', `${error.code}: ${error.message}`)
    assert.match(error.message, /笔记\/甲\.md/)
    return true
  })
  assert.equal(await exists(join(VAULT_B, '.git', 'rebase-merge')), false, 'rebase was not aborted')
  assert.equal(await exists(join(VAULT_B, '.git', 'rebase-apply')), false, 'rebase was not aborted')
  assert.equal(await read(VAULT_B, '笔记/甲.md'), '# 甲\n\nB 端也改了这一行。\n')
})

await check('a local-only repository commits without a remote', async () => {
  await serviceC.saveSettings({ provider: 'git', git: {} })
  await write(VAULT_C, '只有本地.md', '# 只有本地\n')
  const result = await serviceC.run({ trigger: 'manual' })
  assert.equal(result.ok, true, JSON.stringify(result.error))
  assert.equal(result.committed, 1)
  assert.equal(result.pushed, 0)
  assert.equal(git(VAULT_C, ['log', '--format=%s', '-1']).startsWith('notebook sync'), true)
  assert.ok(result.notes.some((note) => note.includes('no git remote')), JSON.stringify(result.notes))
})

await check('status reports git and the last run', async () => {
  const status = await serviceA.status()
  assert.equal(status.provider, 'git')
  assert.ok(status.state.lastSyncAt > 0)
  assert.equal(status.lastResult.provider, 'git')
  assert.equal(status.busy, false)
})

await check('turning sync off rejects a run with sync_not_configured', async () => {
  await serviceC.saveSettings({ provider: 'off' })
  await assert.rejects(serviceC.run({ trigger: 'manual' }), (error) => {
    assert.equal(error.code, 'sync_not_configured')
    return true
  })
})

for (const service of [serviceA, serviceB, serviceC]) await service.dispose()
await fsp.rm(ROOT, { recursive: true, force: true })

console.log(`\nSUMMARY: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  for (const failure of failures) console.log(`  - ${failure.name}`)
  process.exitCode = 1
}
