/**
 * Version history for projects, with Git (isomorphic-git, entirely in the browser).
 *
 * A project is committed unzipped, so Git can diff it:
 *   project.json            the project, pretty-printed (always stock sb3, as saved)
 *   assets/<md5>.<ext>      costumes and sounds, named by content, so unchanged assets cost nothing
 *   text/<sprite>.py        each sprite's scripts as Python-style text, generated for readable diffs only
 * A version is turned back into an .sb3 by zipping project.json and the assets.
 */
import { createTwoFilesPatch } from 'diff'
import git, { type PromiseFsClient } from 'isomorphic-git'
import http from 'isomorphic-git/http/web'
import JSZip from 'jszip'
import type { SerializedProject } from '../sb3/types'
import { fileNameFor } from '../storage/types'
import { targetToText } from '../text'

export interface ProjectRepo {
  fs: PromiseFsClient
  /** The repository's directory in `fs`. */
  dir: string
}

export interface Author {
  name: string
  email?: string
}

export interface Version {
  oid: string
  message: string
  /** Milliseconds since the epoch. */
  time: number
  author: string
}

export interface VersionDiff {
  /** Unified diffs of the sprites' text, one per changed sprite. */
  scripts: { sprite: string; patch: string }[]
  assetsAdded: string[]
  assetsRemoved: string[]
  /** True if project.json changed in ways the scripts do not show (costume order, positions, variables…). */
  otherChanges: boolean
}

const PROJECT_FILE = 'project.json'
const ASSETS_DIR = 'assets'
const TEXT_DIR = 'text'
const DEFAULT_BRANCH = 'main'

const join = (...parts: string[]) => parts.join('/').replace(/\/+/g, '/')

/** The file operations used here (isomorphic-git types its file system loosely). */
interface FileOps {
  stat: (path: string) => Promise<unknown>
  mkdir: (path: string) => Promise<void>
  readdir: (path: string) => Promise<string[]>
  writeFile: (path: string, data: string | Uint8Array, encoding?: string) => Promise<void>
  unlink: (path: string) => Promise<void>
}

const ops = (fs: PromiseFsClient): FileOps => fs.promises as unknown as FileOps

const exists = async (fs: PromiseFsClient, path: string): Promise<boolean> => {
  try {
    await ops(fs).stat(path)
    return true
  } catch {
    return false
  }
}

const mkdirs = async (fs: PromiseFsClient, path: string) => {
  let current = ''
  for (const part of path.split('/').filter(Boolean)) {
    current = `${current}/${part}`
    if (!(await exists(fs, current))) await ops(fs).mkdir(current)
  }
}

const listFiles = async (fs: PromiseFsClient, dir: string): Promise<string[]> =>
  (await exists(fs, dir)) ? await ops(fs).readdir(dir) : []

/** Open the repository at `dir`, creating it (with a `main` branch) if needed. */
export const openProjectRepo = async (fs: PromiseFsClient, dir: string): Promise<ProjectRepo> => {
  await mkdirs(fs, dir)
  if (!(await exists(fs, join(dir, '.git')))) await git.init({ fs, dir, defaultBranch: DEFAULT_BRANCH })
  return { fs, dir }
}

const textFileFor = (spriteName: string) => fileNameFor(spriteName).replace(/\.sb3$/, '.py')

/** Write the files for an .sb3 into the working directory, removing files the project no longer has. */
const writeWorkingTree = async ({ fs, dir }: ProjectRepo, sb3: ArrayBuffer) => {
  const zip = await JSZip.loadAsync(sb3)
  const projectFile = zip.file(PROJECT_FILE)
  if (!projectFile) throw new Error('This .sb3 file has no project.json')
  const project = JSON.parse(await projectFile.async('string')) as SerializedProject
  await ops(fs).writeFile(join(dir, PROJECT_FILE), `${JSON.stringify(project, null, 2)}\n`, 'utf8')

  await mkdirs(fs, join(dir, ASSETS_DIR))
  const assets = new Set<string>()
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir || name === PROJECT_FILE) continue
    assets.add(name)
    await ops(fs).writeFile(join(dir, ASSETS_DIR, name), await file.async('uint8array'))
  }
  for (const name of await listFiles(fs, join(dir, ASSETS_DIR))) {
    if (!assets.has(name)) await ops(fs).unlink(join(dir, ASSETS_DIR, name))
  }

  await mkdirs(fs, join(dir, TEXT_DIR))
  const texts = new Set<string>()
  for (const target of project.targets) {
    const name = textFileFor(target.name)
    texts.add(name)
    await ops(fs).writeFile(join(dir, TEXT_DIR, name), targetToText(target, 'python'), 'utf8')
  }
  for (const name of await listFiles(fs, join(dir, TEXT_DIR))) {
    if (!texts.has(name)) await ops(fs).unlink(join(dir, TEXT_DIR, name))
  }
}

/** Stage every change in the working directory (added, modified and deleted files). */
const stageAll = async ({ fs, dir }: ProjectRepo) => {
  for (const [filepath, , workdir] of await git.statusMatrix({ fs, dir })) {
    if (workdir === 0) await git.remove({ fs, dir, filepath })
    else await git.add({ fs, dir, filepath })
  }
}

const hasStagedChanges = async ({ fs, dir }: ProjectRepo): Promise<boolean> =>
  (await git.statusMatrix({ fs, dir })).some(([, head, , stage]) => head !== stage)

/**
 * Record the project as a new version. Returns the new commit, or null when nothing changed since the last one.
 */
export const commitProject = async (
  repo: ProjectRepo,
  sb3: ArrayBuffer,
  message: string,
  author: Author,
): Promise<string | null> => {
  await writeWorkingTree(repo, sb3)
  await stageAll(repo)
  const isFirst = (await git.log({ ...repo, depth: 1 }).catch(() => [])).length === 0
  if (!isFirst && !(await hasStagedChanges(repo))) return null
  return git.commit({ ...repo, message, author: { name: author.name, email: author.email ?? '' } })
}

/** The versions on the current branch (or `ref`), newest first. */
export const listVersions = async (repo: ProjectRepo, ref = 'HEAD', depth = 200): Promise<Version[]> => {
  const entries = await git.log({ ...repo, ref, depth }).catch(() => [])
  return entries.map((entry) => ({
    oid: entry.oid,
    message: entry.commit.message.trim(),
    time: entry.commit.author.timestamp * 1000,
    author: entry.commit.author.name,
  }))
}

const readText = async (repo: ProjectRepo, oid: string, filepath: string): Promise<string | undefined> => {
  try {
    const { blob } = await git.readBlob({ ...repo, oid, filepath })
    return new TextDecoder().decode(blob)
  } catch {
    return undefined
  }
}

const treeEntries = async (
  repo: ProjectRepo,
  oid: string,
  filepath: string,
): Promise<{ path: string; oid: string }[]> => {
  try {
    const { tree } = await git.readTree({ ...repo, oid, filepath })
    return tree.filter((entry) => entry.type === 'blob').map((entry) => ({ path: entry.path, oid: entry.oid }))
  } catch {
    return []
  }
}

/** Rebuild the .sb3 file of a version. */
export const readVersion = async (repo: ProjectRepo, oid: string): Promise<ArrayBuffer> => {
  const projectJson = await readText(repo, oid, PROJECT_FILE)
  if (projectJson === undefined) throw new Error(`Version ${oid.slice(0, 7)} has no project.json`)
  const zip = new JSZip()
  zip.file(PROJECT_FILE, JSON.stringify(JSON.parse(projectJson)))
  for (const entry of await treeEntries(repo, oid, ASSETS_DIR)) {
    const { blob } = await git.readBlob({ ...repo, oid: entry.oid })
    zip.file(entry.path, blob)
  }
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
}

/** What changed from version `from` to version `to`. */
export const diffVersions = async (repo: ProjectRepo, from: string, to: string): Promise<VersionDiff> => {
  const [fromTexts, toTexts] = await Promise.all([treeEntries(repo, from, TEXT_DIR), treeEntries(repo, to, TEXT_DIR)])
  const scripts: VersionDiff['scripts'] = []
  for (const path of new Set([...fromTexts, ...toTexts].map((entry) => entry.path))) {
    const before = (await readText(repo, from, join(TEXT_DIR, path))) ?? ''
    const after = (await readText(repo, to, join(TEXT_DIR, path))) ?? ''
    if (before === after) continue
    const sprite = path.replace(/\.py$/, '')
    scripts.push({
      sprite,
      patch: createTwoFilesPatch(`${sprite} (before)`, `${sprite} (after)`, before, after, '', '', { context: 3 }),
    })
  }
  const [fromAssets, toAssets] = await Promise.all([
    treeEntries(repo, from, ASSETS_DIR),
    treeEntries(repo, to, ASSETS_DIR),
  ])
  const fromNames = new Set(fromAssets.map((entry) => entry.path))
  const toNames = new Set(toAssets.map((entry) => entry.path))
  const scriptsOnly = (json: string | undefined) => {
    if (!json) return ''
    const project = JSON.parse(json) as SerializedProject
    // Ignore what the text diff already shows, and the agent string, which changes with every save.
    return JSON.stringify({
      ...project,
      meta: undefined,
      targets: project.targets.map((t) => ({ ...t, blocks: undefined, comments: undefined })),
    })
  }
  const [fromProject, toProject] = await Promise.all([
    readText(repo, from, PROJECT_FILE),
    readText(repo, to, PROJECT_FILE),
  ])
  return {
    scripts,
    assetsAdded: [...toNames].filter((name) => !fromNames.has(name)),
    assetsRemoved: [...fromNames].filter((name) => !toNames.has(name)),
    otherChanges: scriptsOnly(fromProject) !== scriptsOnly(toProject),
  }
}

export const currentBranch = async (repo: ProjectRepo): Promise<string> =>
  (await git.currentBranch({ ...repo, fullname: false })) ?? DEFAULT_BRANCH

export const listBranches = async (repo: ProjectRepo): Promise<string[]> => git.listBranches(repo)

/** Create a branch at the current version and switch to it. */
export const createBranch = async (repo: ProjectRepo, name: string): Promise<void> => {
  await git.branch({ ...repo, ref: name, checkout: true })
}

/** Switch to another branch; returns the .sb3 of its latest version. */
export const switchBranch = async (repo: ProjectRepo, name: string): Promise<ArrayBuffer> => {
  await git.checkout({ ...repo, ref: name, force: true })
  const head = await git.resolveRef({ ...repo, ref: 'HEAD' })
  return readVersion(repo, head)
}

export interface RemoteOptions {
  /** HTTPS URL of a GitHub/GitLab repository. */
  url: string
  /** A personal access token with permission to push. */
  token: string
  /** isomorphic-git needs a CORS proxy for GitHub, e.g. https://cors.isomorphic-git.org. */
  corsProxy?: string
}

/** Push the current branch to a remote repository. */
export const pushToRemote = async (repo: ProjectRepo, options: RemoteOptions): Promise<void> => {
  await git.setConfig({ ...repo, path: 'remote.origin.url', value: options.url })
  const result = await git.push({
    ...repo,
    http,
    remote: 'origin',
    ref: await currentBranch(repo),
    corsProxy: options.corsProxy,
    onAuth: () => ({ username: options.token, password: 'x-oauth-basic' }),
  })
  if (!result.ok) throw new Error(`Push failed: ${result.error ?? 'unknown error'}`)
}
