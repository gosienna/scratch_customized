/**
 * A project's whole Git history as one file: a standard Git bundle (v2), so desktop Git can read it too
 * (`git clone Project.scratch.bundle`). Stores keep these files as the backup of a browser repository.
 *
 * Layout: the line `# v2 git bundle`, one `<oid> <ref>` line per branch (and HEAD), an empty line, then a
 * packfile holding every object the branches reach.
 */
import git from 'isomorphic-git'
import type { PromiseFsClient } from 'isomorphic-git'
import { openProjectRepo, type ProjectRepo } from './repo'

const SIGNATURE = '# v2 git bundle\n'
const PACK_DIR = '.git/objects/pack'

export interface ParsedBundle {
  /** Branch name → commit. */
  branches: Map<string, string>
  /** The commit HEAD pointed to, if the bundle says. */
  head?: string
  pack: Uint8Array
}

export interface Bundle {
  bytes: Uint8Array
  /** Identifies which commits the bundle's branches point to (see `bundleToken`). */
  token: string
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

const sha1 = async (text: string): Promise<string> =>
  hex(new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))))

/** A short fingerprint of a set of branches: equal exactly when every branch points to the same commit. */
const tokenOf = (branches: Map<string, string>): Promise<string> =>
  sha1(
    [...branches]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, oid]) => `${oid} ${name}\n`)
      .join(''),
  )

export const parseBundle = (bytes: Uint8Array): ParsedBundle => {
  const signature = new TextDecoder().decode(bytes.subarray(0, SIGNATURE.length))
  if (signature !== SIGNATURE) throw new Error('This file is not a Git bundle')
  const branches = new Map<string, string>()
  let head: string | undefined
  let offset = SIGNATURE.length
  for (;;) {
    const end = bytes.indexOf(0x0a, offset)
    if (end < 0) throw new Error('This Git bundle is cut short')
    const line = new TextDecoder().decode(bytes.subarray(offset, end))
    offset = end + 1
    if (line === '') break
    if (line.startsWith('-')) throw new Error('This Git bundle needs commits from another repository')
    const [oid, ref] = line.split(' ')
    if (!oid || !ref) throw new Error(`This Git bundle has a malformed line: ${line}`)
    if (ref === 'HEAD') head = oid
    else if (ref.startsWith('refs/heads/')) branches.set(ref.slice('refs/heads/'.length), oid)
  }
  return { branches, head, pack: bytes.subarray(offset) }
}

/** The token of a bundle file, from its header. */
export const bundleToken = (bytes: Uint8Array): Promise<string> => tokenOf(parseBundle(bytes).branches)

/** The branches of a repository, by name. */
const localBranches = async (repo: ProjectRepo): Promise<Map<string, string>> => {
  const branches = new Map<string, string>()
  for (const name of await git.listBranches(repo)) branches.set(name, await git.resolveRef({ ...repo, ref: name }))
  return branches
}

/** The token a bundle of the repository's branches would have right now. */
export const repoToken = async (repo: ProjectRepo): Promise<string> => tokenOf(await localBranches(repo))

/** Every commit, tree and blob reachable from `commits`. */
const reachableObjects = async (repo: ProjectRepo, commits: string[]): Promise<string[]> => {
  const seen = new Set<string>()
  const trees: string[] = []
  const pending = [...commits]
  for (let oid = pending.pop(); oid; oid = pending.pop()) {
    if (seen.has(oid)) continue
    seen.add(oid)
    const { commit } = await git.readCommit({ ...repo, oid })
    trees.push(commit.tree)
    pending.push(...commit.parent)
  }
  for (let oid = trees.pop(); oid; oid = trees.pop()) {
    if (seen.has(oid)) continue
    seen.add(oid)
    const { tree } = await git.readTree({ ...repo, oid })
    for (const entry of tree) {
      if (entry.type === 'tree') trees.push(entry.oid)
      else if (entry.type === 'blob') seen.add(entry.oid)
    }
  }
  return [...seen]
}

/** Pack every branch of the repository into a bundle. */
export const createBundle = async (repo: ProjectRepo): Promise<Bundle> => {
  const branches = await localBranches(repo)
  if (branches.size === 0) throw new Error('This project has no saved versions yet')
  const oids = await reachableObjects(repo, [...branches.values()])
  const { packfile } = await git.packObjects({ ...repo, oids, write: false })
  if (!packfile) throw new Error('isomorphic-git did not return a packfile')
  const head = await git.resolveRef({ ...repo, ref: 'HEAD' })
  const lines = [...branches].map(([name, oid]) => `${oid} refs/heads/${name}\n`)
  const header = new TextEncoder().encode(`${SIGNATURE}${head} HEAD\n${lines.join('')}\n`)
  const bytes = new Uint8Array(header.length + packfile.length)
  bytes.set(header)
  bytes.set(packfile, header.length)
  return { bytes, token: await tokenOf(branches) }
}

/** Add a bundle's objects to the repository, without changing any branch. Returns the bundle's branches. */
export const fetchBundle = async (repo: ProjectRepo, bytes: Uint8Array): Promise<ParsedBundle> => {
  const parsed = parseBundle(bytes)
  // A packfile ends with the SHA-1 of its contents, which Git also uses as its file name.
  const name = `pack-${hex(parsed.pack.subarray(parsed.pack.length - 20))}`
  const filepath = `${PACK_DIR}/${name}.pack`
  const fs = repo.fs.promises as unknown as {
    mkdir: (path: string) => Promise<void>
    stat: (path: string) => Promise<unknown>
    writeFile: (path: string, data: Uint8Array) => Promise<void>
  }
  const absolute = (path: string) => `${repo.dir}/${path}`
  const exists = (path: string) =>
    fs.stat(absolute(path)).then(
      () => true,
      () => false,
    )
  if (!(await exists(`${PACK_DIR}/${name}.idx`))) {
    if (!(await exists(PACK_DIR))) await fs.mkdir(absolute(PACK_DIR))
    await fs.writeFile(absolute(filepath), parsed.pack)
    await git.indexPack({ ...repo, filepath })
  }
  return parsed
}

/** Make a new repository at `dir` from a bundle, with its branches, and check out the branch HEAD was on. */
export const cloneBundle = async (fs: PromiseFsClient, dir: string, bytes: Uint8Array): Promise<ProjectRepo> => {
  const repo = await openProjectRepo(fs, dir)
  const { branches, head } = await fetchBundle(repo, bytes)
  const names = [...branches.keys()]
  if (names.length === 0) throw new Error('This Git bundle has no branches')
  for (const [name, oid] of branches)
    await git.writeRef({ ...repo, ref: `refs/heads/${name}`, value: oid, force: true })
  const onHead = names.filter((name) => branches.get(name) === head)
  const current = [...onHead, ...names].find((name) => name === 'main') ?? onHead[0] ?? names[0]
  await git.writeRef({ ...repo, ref: 'HEAD', value: `refs/heads/${current}`, symbolic: true, force: true })
  await git.checkout({ ...repo, ref: current, force: true })
  return repo
}

export interface SyncResult {
  /**
   * Branches the bundle has newer commits on that cannot be taken without a merge (or, for the current branch,
   * without reloading the project).
   */
  diverged: string[]
  /** Branches added or fast-forwarded from the bundle. */
  updated: string[]
}

/**
 * Bring the bundle's branches into the repository where that loses nothing: new branches are added, and other
 * branches are fast-forwarded. The current branch is moved only with `moveCurrent` (for when the project is about
 * to be reloaded from it; otherwise the editor shows its files). A branch that cannot be moved is reported in
 * `diverged`.
 */
export const syncFromBundle = async (
  repo: ProjectRepo,
  bytes: Uint8Array,
  { moveCurrent = false } = {},
): Promise<SyncResult> => {
  const { branches } = await fetchBundle(repo, bytes)
  const local = await localBranches(repo)
  const current = await git.currentBranch({ ...repo, fullname: false })
  const result: SyncResult = { diverged: [], updated: [] }
  for (const [name, theirs] of branches) {
    const ours = local.get(name)
    if (ours === theirs) continue
    const oursContainsTheirs =
      ours !== undefined && (await git.isDescendent({ ...repo, oid: ours, ancestor: theirs, depth: -1 }))
    if (oursContainsTheirs) continue
    const theirsContainsOurs =
      ours === undefined || (await git.isDescendent({ ...repo, oid: theirs, ancestor: ours, depth: -1 }))
    if (theirsContainsOurs && (name !== current || moveCurrent)) {
      await git.writeRef({ ...repo, ref: `refs/heads/${name}`, value: theirs, force: true })
      if (name === current) await git.checkout({ ...repo, ref: name, force: true })
      result.updated.push(name)
    } else {
      result.diverged.push(name)
    }
  }
  return result
}
