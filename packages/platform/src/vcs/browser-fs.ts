/** The browser file system that holds project repositories (in IndexedDB, via LightningFS). */
import LightningFS from '@isomorphic-git/lightning-fs'
import type { PromiseFsClient } from 'isomorphic-git'
import { listProjectRepos, removeDirectory, type RepoSummary } from './repo'

const PROJECTS_ROOT = '/projects'

let browserFs: PromiseFsClient | undefined

export const getBrowserGitFs = (): PromiseFsClient => {
  browserFs ??= new LightningFS('scratch-customized-git') as unknown as PromiseFsClient
  return browserFs
}

/** A new, unique repository ID. */
export const newProjectId = (): string => crypto.randomUUID()

/** The repository directory for a repository ID. */
export const repoDirFor = (id: string): string => `${PROJECTS_ROOT}/${id}`

/** The project repositories in this browser, newest first. */
export const listBrowserRepos = (fs: PromiseFsClient = getBrowserGitFs()): Promise<RepoSummary[]> =>
  listProjectRepos(fs, PROJECTS_ROOT)

export const deleteBrowserRepo = (id: string, fs: PromiseFsClient = getBrowserGitFs()): Promise<void> =>
  removeDirectory(fs, repoDirFor(id))
