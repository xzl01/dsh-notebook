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

// Keep every git command short so the unreachable-remote case can be tested
// without adding a minute to the suite.
process.env.DSH_NOTEBOOK_GIT_TIMEOUT_MS = '3000'

const { createSyncService, gitCredentialPrefix, GIT_CREDENTIAL_HELPER } = await import(join(WORKSPACE, 'sync.js'))

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

await check('an unreachable git remote times out instead of hanging', async () => {
  const slowSsh = join(ROOT, 'slow-ssh.sh')
  await fsp.writeFile(slowSsh, '#!/bin/sh\nsleep 30\n', { mode: 0o755 })
  await fsp.chmod(slowSsh, 0o755)
  const vaultD = join(ROOT, 'vault-d')
  await fsp.mkdir(vaultD, { recursive: true })
  await write(vaultD, '挂起.md', '# 挂起\n')

  const service = createSyncService({ root: vaultD })
  await service.saveSettings({ provider: 'git', git: { remote: 'ssh://example.invalid/notes.git', branch: 'main' } })
  const previous = process.env.GIT_SSH_COMMAND
  process.env.GIT_SSH_COMMAND = slowSsh
  const started = Date.now()
  try {
    await assert.rejects(service.run({ trigger: 'manual' }), (error) => {
      assert.ok(
        ['git_timeout', 'git_unreachable', 'git_error'].includes(error.code),
        `${error.code}: ${error.message}`,
      )
      return true
    })
    const elapsed = Date.now() - started
    assert.ok(elapsed < 15000, `the sync took ${elapsed}ms`)
    const status = await service.status()
    assert.equal(status.busy, false, 'the run is still marked busy')
  } finally {
    if (previous === undefined) delete process.env.GIT_SSH_COMMAND
    else process.env.GIT_SSH_COMMAND = previous
    await service.dispose()
  }
})

await check('HTTP credentials are stored and handed to git through an env-backed helper', async () => {
  assert.deepEqual(gitCredentialPrefix('', ''), { args: [], env: {} })
  const credential = gitCredentialPrefix('xzl', 'token-123')
  assert.equal(credential.args[0], '-c')
  assert.equal(credential.args[1], 'credential.helper=')
  assert.equal(credential.args[3], `credential.helper=${GIT_CREDENTIAL_HELPER}`)
  assert.equal(credential.env.DSH_GIT_USERNAME, 'xzl')
  assert.equal(credential.env.DSH_GIT_PASSWORD, 'token-123')
  assert.ok(!JSON.stringify(credential.args).includes('token-123'), 'the token must not appear in argv')

  await serviceC.saveSettings({ git: { username: 'xzl', password: 'token-123' } })
  const status = await serviceC.status()
  assert.equal(status.settings.git.username, 'xzl')
  assert.equal(status.settings.git.password, 'token-123')
  const stored = JSON.parse(await fsp.readFile(serviceC.settingsPath, 'utf8'))
  assert.equal(stored.git.password, 'token-123')
  if (process.platform !== 'win32') {
    assert.equal((await fsp.stat(serviceC.settingsPath)).mode & 0o777, 0o600)
  }
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

await check('writing stats live in the synced tree', async () => {
  await write(VAULT_A, '统计/写作热力.json', JSON.stringify({ version: 1, days: { '2026-11-10': 42 } }))
  const result = await serviceA.run({ trigger: 'manual' })
  assert.equal(result.ok, true, JSON.stringify(result.error))
  const content = git(REMOTE, ['show', 'main:统计/写作热力.json'])
  assert(content.includes('"version":1'), content)
})

for (const service of [serviceA, serviceB, serviceC]) await service.dispose()
await fsp.rm(ROOT, { recursive: true, force: true })

console.log(`\nSUMMARY: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  for (const failure of failures) console.log(`  - ${failure.name}`)
  process.exitCode = 1
}
