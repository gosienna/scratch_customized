import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { lowerProject } from '../../src/compat/lower'
import type { SerializedProject } from '../../src/sb3/types'
import { applyText } from '../../src/text'
import {
  commitProject,
  createBranch,
  currentBranch,
  diffVersions,
  listBranches,
  listVersions,
  openProjectRepo,
  readVersion,
  type ProjectRepo,
  switchBranch,
} from '../../src/vcs/repo'
import { customFeaturesProject } from '../fixtures/custom-features'
import { canonicalScripts } from '../helpers'
import { createVm, validateWithScratchParser } from './vm-helpers'

let dir: string
let repo: ProjectRepo
const me = { name: 'Tester' }

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scratch-vcs-'))
  repo = await openProjectRepo(fs, dir)
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

/** Load project JSON into a VM and save it as .sb3. */
const sb3Of = async (project: SerializedProject): Promise<ArrayBuffer> => {
  const vm = createVm()
  await vm.loadProject(JSON.parse(JSON.stringify(project)))
  const blob: Blob = await vm.saveProjectSb3()
  return blob.arrayBuffer()
}

const projectOf = async (sb3: ArrayBuffer): Promise<SerializedProject> => {
  const vm = createVm()
  await vm.loadProject(sb3)
  return JSON.parse(vm.toJSON())
}

test('commits versions, rebuilds them, diffs them and keeps branches apart', async () => {
  const first = lowerProject(customFeaturesProject())
  const firstSb3 = await sb3Of(first)
  const firstOid = await commitProject(repo, firstSb3, 'First version', me)
  expect(firstOid).toMatch(/^[0-9a-f]{40}$/)
  expect(await commitProject(repo, firstSb3, 'Nothing changed', me)).toBeNull()
  expect(fs.readdirSync(path.join(dir, 'text'))).toEqual(['Sprite1.py', 'Stage.py'])

  const loaded = await projectOf(firstSb3)
  const second = applyText(loaded, 'Sprite1', 'when flag_clicked:\n    say("hello")\n', 'python')
  const secondOid = await commitProject(repo, await sb3Of(second), 'Say hello', me)
  if (!firstOid || !secondOid) throw new Error('expected two commits')

  const versions = await listVersions(repo)
  expect(versions.map((v) => v.message)).toEqual(['Say hello', 'First version'])

  const diff = await diffVersions(repo, firstOid, secondOid)
  expect(diff.scripts.map((s) => s.sprite)).toEqual(['Sprite1'])
  expect(diff.scripts[0]?.patch).toContain('+    say("hello")')
  expect(diff.scripts[0]?.patch).toContain('-    count = 0')
  expect(diff.assetsAdded).toEqual([])

  // An old version rebuilds into a valid .sb3 with the same program.
  const rebuilt = await readVersion(repo, firstOid)
  const rebuiltProject = await projectOf(rebuilt)
  await validateWithScratchParser(rebuiltProject)
  expect(rebuiltProject.targets.map(canonicalScripts)).toEqual(
    (await projectOf(firstSb3)).targets.map(canonicalScripts),
  )

  // Branches.
  await createBranch(repo, 'experiment')
  expect(await currentBranch(repo)).toBe('experiment')
  const third = applyText(second, 'Sprite1', 'when flag_clicked:\n    say("experiment")\n', 'python')
  await commitProject(repo, await sb3Of(third), 'Try something', me)
  expect((await listVersions(repo)).length).toBe(3)

  const mainSb3 = await switchBranch(repo, 'main')
  expect(await currentBranch(repo)).toBe('main')
  expect((await listVersions(repo)).length).toBe(2)
  expect(JSON.stringify(await projectOf(mainSb3))).toContain('"hello"')
  expect((await listBranches(repo)).sort()).toEqual(['experiment', 'main'])
})
