import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { lowerProject } from '../../src/compat/lower'
import type { SerializedProject } from '../../src/sb3/types'
import { applyText } from '../../src/text'
import { bundleToken, cloneBundle, createBundle, parseBundle, repoToken, syncFromBundle } from '../../src/vcs/bundle'
import {
  commitProject,
  createBranch,
  currentBranch,
  getRepoSetting,
  listProjectRepos,
  listVersions,
  openProjectRepo,
  type ProjectRepo,
  readVersion,
  removeDirectory,
  setRepoSetting,
  switchBranch,
} from '../../src/vcs/repo'
import { customFeaturesProject } from '../fixtures/custom-features'
import { createVm } from './vm-helpers'

let root: string
let repo: ProjectRepo
const me = { name: 'Tester' }

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'scratch-bundle-'))
  repo = await openProjectRepo(fs, path.join(root, 'a'))
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const sb3Of = async (project: SerializedProject): Promise<ArrayBuffer> => {
  const vm = createVm()
  await vm.loadProject(JSON.parse(JSON.stringify(project)))
  return (await vm.saveProjectSb3()).arrayBuffer()
}

const say = (base: SerializedProject, text: string) =>
  applyText(base, 'Sprite1', `when flag_clicked:\n    say("${text}")\n`, 'python')

const base = () => lowerProject(customFeaturesProject())

/** Two versions on main and one more on a branch, ending on main. */
const makeHistory = async () => {
  await commitProject(repo, await sb3Of(base()), 'First', me)
  await commitProject(repo, await sb3Of(say(base(), 'hello')), 'Second', me)
  await createBranch(repo, 'experiment')
  await commitProject(repo, await sb3Of(say(base(), 'experiment')), 'Third', me)
  await switchBranch(repo, 'main')
}

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'])
    return true
  } catch {
    return false
  }
})()

describe('Git bundles', () => {
  test('a bundle restores every branch and version', async () => {
    await makeHistory()
    const bundle = await createBundle(repo)
    const parsed = parseBundle(bundle.bytes)
    expect([...parsed.branches.keys()].sort()).toEqual(['experiment', 'main'])
    expect(await bundleToken(bundle.bytes)).toBe(bundle.token)
    expect(await repoToken(repo)).toBe(bundle.token)

    const copy = await cloneBundle(fs, path.join(root, 'b'), bundle.bytes)
    expect(await currentBranch(copy)).toBe('main')
    const versions = await listVersions(copy)
    expect(versions.map((v) => v.message)).toEqual(['Second', 'First'])
    expect((await listVersions(copy, 'experiment')).map((v) => v.message)).toEqual(['Third', 'Second', 'First'])
    for (const version of versions) {
      expect(new Uint8Array(await readVersion(copy, version.oid))).toEqual(
        new Uint8Array(await readVersion(repo, version.oid)),
      )
    }
    // The working directory is checked out, so the next save only records what changed.
    expect(await commitProject(copy, await readVersion(copy, versions[0].oid), 'Same', me)).toBeNull()
  })

  test('the token changes exactly when a branch moves', async () => {
    await makeHistory()
    const before = (await createBundle(repo)).token
    expect((await createBundle(repo)).token).toBe(before)
    await commitProject(repo, await sb3Of(say(base(), 'more')), 'Fourth', me)
    expect((await createBundle(repo)).token).not.toBe(before)
  })

  test.skipIf(!hasGit)('desktop Git can clone the bundle', async () => {
    await makeHistory()
    const file = path.join(root, 'Project.scratch.bundle')
    fs.writeFileSync(file, (await createBundle(repo)).bytes)
    execFileSync('git', ['clone', '--quiet', file, 'cloned'], { cwd: root, stdio: 'pipe' })
    const cloned = path.join(root, 'cloned')
    execFileSync('git', ['fsck', '--full', '--strict'], { cwd: cloned, stdio: 'pipe' })
    execFileSync('git', ['bundle', 'verify', file], { cwd: cloned, stdio: 'pipe' })
    const log = execFileSync('git', ['log', '--format=%s', 'origin/main'], { cwd: cloned })
    expect(log.toString().trim().split('\n')).toEqual(['Second', 'First'])
    expect(fs.existsSync(path.join(root, 'cloned', 'project.json'))).toBe(true)
  })

  test('syncing adds new branches, fast-forwards others, and reports what needs a merge', async () => {
    await makeHistory()
    const other = await cloneBundle(fs, path.join(root, 'b'), (await createBundle(repo)).bytes)

    // The other copy adds to `experiment`, makes a new branch, and adds to `main`.
    await switchBranch(other, 'experiment')
    await commitProject(other, await sb3Of(say(base(), 'experiment 2')), 'Fourth', me)
    await createBranch(other, 'idea')
    await commitProject(other, await sb3Of(say(base(), 'idea')), 'Idea', me)
    await switchBranch(other, 'main')
    await commitProject(other, await sb3Of(say(base(), 'main elsewhere')), 'Main elsewhere', me)

    const result = await syncFromBundle(repo, (await createBundle(other)).bytes)
    expect(result.updated.sort()).toEqual(['experiment', 'idea'])
    // `main` is checked out here, so it is never moved, even though this copy has nothing newer on it.
    expect(result.diverged).toEqual(['main'])
    expect((await listVersions(repo, 'experiment'))[0]?.message).toBe('Fourth')
    expect((await listVersions(repo))[0]?.message).toBe('Second')

    // When the project is about to be reloaded, the current branch can be fast-forwarded too.
    const behind = await cloneBundle(fs, path.join(root, 'c'), (await createBundle(repo)).bytes)
    await commitProject(repo, await sb3Of(say(base(), 'newer')), 'Newer', me)
    expect(await syncFromBundle(behind, (await createBundle(repo)).bytes)).toMatchObject({ diverged: ['main'] })
    expect(await syncFromBundle(behind, (await createBundle(repo)).bytes, { moveCurrent: true })).toMatchObject({
      diverged: [],
      updated: ['main'],
    })
    expect((await listVersions(behind))[0]?.message).toBe('Newer')
    expect(
      await commitProject(behind, await readVersion(repo, (await listVersions(repo))[0].oid), 'x', me),
    ).toBeNull()

    // Syncing a bundle this repository already contains changes nothing.
    expect(await syncFromBundle(repo, (await createBundle(repo)).bytes)).toEqual({ diverged: [], updated: [] })
  })

  test('rejects files that are not bundles', () => {
    expect(() => parseBundle(new TextEncoder().encode('PK\u0003\u0004'))).toThrow('not a Git bundle')
  })
})

describe('project repositories', () => {
  test('keep settings in their Git config, and are listed and removed', async () => {
    await setRepoSetting(repo, 'name', 'Space Game')
    await commitProject(repo, await sb3Of(base()), 'First', me)
    await setRepoSetting(repo, 'backupKind', 'drive')
    await setRepoSetting(repo, 'backupId', 'f1')
    expect(await getRepoSetting(repo, 'name')).toBe('Space Game')
    await setRepoSetting(repo, 'backupId', undefined)
    expect(await getRepoSetting(repo, 'backupId')).toBeUndefined()

    // A repository from before names were kept in the config is named by its directory.
    const old = await openProjectRepo(fs, path.join(root, encodeURIComponent('Old game')))
    await commitProject(old, await sb3Of(base()), 'First', me)

    const listed = await listProjectRepos(fs, root)
    expect(listed.map((r) => [r.id, r.name, r.backupKind])).toEqual(
      expect.arrayContaining([
        ['a', 'Space Game', 'drive'],
        ['Old%20game', 'Old game', undefined],
      ]),
    )
    expect(listed.every((r) => r.modified > 0)).toBe(true)

    await removeDirectory(fs, old.dir)
    expect((await listProjectRepos(fs, root)).map((r) => r.id)).toEqual(['a'])
    expect(await git.listBranches(repo)).toEqual(['main'])
  })
})
