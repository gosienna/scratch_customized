/** The browser file system that holds project repositories (in IndexedDB, via LightningFS). */
import LightningFS from '@isomorphic-git/lightning-fs'
import type { PromiseFsClient } from 'isomorphic-git'

let browserFs: PromiseFsClient | undefined

export const getBrowserGitFs = (): PromiseFsClient => {
  browserFs ??= new LightningFS('scratch-customized-git') as unknown as PromiseFsClient
  return browserFs
}

/** The repository directory for a project name. */
export const repoDirFor = (projectName: string): string =>
  `/projects/${encodeURIComponent(projectName.trim() || 'Project')}`
