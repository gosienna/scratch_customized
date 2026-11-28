// CUSTOM: every project is a Git repository in this browser. Saving commits to it and then, if the project is
// linked to a folder or Google Drive, uploads the whole history there as one Git bundle file. A .sb3 file is made
// only when one is exported (File > Save to your computer, or a version in History).
import {
    bundleToken,
    cloneBundle,
    commitProject,
    createBranch,
    createBundle,
    currentBranch,
    deleteBrowserRepo,
    getBrowserGitFs,
    getRepoSetting,
    getSetting,
    headVersion,
    legacyBrowserProjects,
    listBrowserRepos,
    newProjectId,
    openProjectRepo,
    readVersion,
    repoDirFor,
    setRepoSetting,
    setSetting,
    switchBranch,
    syncFromBundle
} from '@scratch-customized/platform';

import log from '../log';
import {reloadProject} from './reload-project';
import {getProjectStores} from './project-stores';
import {captureThumbnail} from './project-thumbnail';

const AUTHOR = {name: 'Scratch Customized user'};
const DEFAULT_MESSAGE = 'Saved version';

/** Thrown when a backup has commits this browser does not, on a branch both changed. */
class BackupConflictError extends Error {}

const openRepo = repoId => openProjectRepo(getBrowserGitFs(), repoDirFor(repoId));

const thumbnailKey = repoId => `repoThumbnail.${repoId}`;

/**
 * @param {string} repoId - a repository in this browser.
 * @returns {Promise<?Blob>} the picture of the stage saved with its last commit.
 */
const repoThumbnail = repoId => getSetting(thumbnailKey(repoId));

const describeBackup = kind => (kind === 'drive' ? 'Google Drive' : 'the folder');

/**
 * Upload the repository to its backup, unless the backup has changes from elsewhere that cannot be added
 * without a merge. Changes elsewhere that add to other branches are taken in first, so nothing is lost.
 * @param {ProjectRepo} repo - the repository.
 * @param {{kind: string, id: ?string, name: string, thumbnail: ?Blob}} backup - where to upload it.
 * @returns {Promise<ProjectInfo>} the uploaded file.
 */
const backUp = async (repo, {kind, id, name, thumbnail}) => {
    const store = getProjectStores()[kind];
    if (!store) throw new Error(`backUp: there is no ${kind} store in this build`);
    if (id) {
        const [theirs, synced] = await Promise.all([store.token(id), getRepoSetting(repo, 'syncedToken')]);
        if (theirs && theirs !== synced) {
            const {diverged} = await syncFromBundle(repo, new Uint8Array(await store.load(id)));
            if (diverged.length > 0) {
                throw new BackupConflictError(
                    `This project was also changed on another computer (in ${describeBackup(kind)}), on ` +
                    `${diverged.join(', ')}. Your version is saved in this browser; ` +
                    'save it as a new project to keep both.'
                );
            }
        }
    }
    const bundle = await createBundle(repo);
    const info = await store.save(name, bundle.bytes, {...(id && {id}), thumbnail, token: bundle.token});
    await setRepoSetting(repo, 'backupKind', kind);
    await setRepoSetting(repo, 'backupId', info.id);
    await setRepoSetting(repo, 'syncedToken', bundle.token);
    return info;
};

/**
 * Commit the editor's project, then back it up.
 * @param {object} options - what to save.
 * @param {VirtualMachine} options.vm - the VM.
 * @param {?object} options.current - the current project's repository (from Redux), or null.
 * @param {string} options.name - the project name.
 * @param {string} [options.message] - the commit message.
 * @param {?string} [options.backupKind] - where to back it up: 'folder', 'drive', or null for nowhere. Defaults
 * to where it is backed up now.
 * @param {boolean} [options.asNew] - start a new repository instead of committing to the current one.
 * @returns {Promise<{current: object, branch: string, committed: boolean, backupError: ?Error}>} the repository
 * now, its branch, whether there was anything to commit, and why the backup failed (if it did).
 */
const saveProject = async ({vm, current, name, message, backupKind = current?.backupKind ?? null, asNew = false}) => {
    const isNew = asNew || !current;
    const repoId = isNew ? newProjectId() : current.repoId;
    const repo = await openRepo(repoId);
    await setRepoSetting(repo, 'name', name);
    const [sb3, thumbnail] = await Promise.all([
        vm.saveProjectSb3().then(blob => blob.arrayBuffer()),
        captureThumbnail(vm).catch(e => {
            log.warn('saveProject: saving without a thumbnail; the stage could not be captured', e);
            return null;
        })
    ]);
    const oid = await commitProject(repo, sb3, message?.trim() || DEFAULT_MESSAGE, AUTHOR);
    if (thumbnail) await setSetting(thumbnailKey(repoId), thumbnail);
    let backupId = !isNew && backupKind === current.backupKind ? current.backupId : null;
    let backupError = null;
    if (backupKind) {
        try {
            backupId = (await backUp(repo, {kind: backupKind, id: backupId, name, thumbnail})).id;
        } catch (e) {
            // The commit is kept either way; the backup is tried again on the next save.
            backupError = e;
        }
    }
    return {
        current: {repoId, name, backupKind, backupId},
        branch: await currentBranch(repo),
        committed: Boolean(oid),
        backupError
    };
};

const loadHead = async (vm, repo) => {
    const head = await headVersion(repo);
    if (!head) throw new Error('This project has no saved versions');
    await vm.loadProject(await readVersion(repo, head));
};

/**
 * Open a repository from this browser.
 * @param {VirtualMachine} vm - the VM to load it into.
 * @param {RepoSummary} summary - the repository, from `listBrowserProjects`.
 * @returns {Promise<{current: object, branch: string}>} the opened repository and its branch.
 */
const openBrowserProject = async (vm, summary) => {
    const repo = await openRepo(summary.id);
    await loadHead(vm, repo);
    return {
        current: {
            repoId: summary.id,
            name: summary.name,
            backupKind: summary.backupKind ?? null,
            backupId: summary.backupId ?? null
        },
        branch: await currentBranch(repo)
    };
};

/**
 * Open a project from a folder or Google Drive. A bundle becomes (or updates) a repository in this browser; an
 * old .sb3 file is imported as the first version of a new repository, backed up beside it on the next save.
 * @param {VirtualMachine} vm - the VM to load it into.
 * @param {string} kind - 'folder' or 'drive'.
 * @param {ProjectInfo} info - the file, from the store's list.
 * @returns {Promise<{current: object, branch: string}>} the opened repository and its branch.
 */
const openStoredProject = async (vm, kind, info) => {
    const store = getProjectStores()[kind];
    const data = await store.load(info.id);
    const thumbnail = await store.thumbnail(info.id).catch(e => {
        log.warn(`openStoredProject: no thumbnail for ${kind} file ${info.id}`, e);
        return null;
    });

    if (info.format === 'sb3') {
        await vm.loadProject(data);
        const repoId = newProjectId();
        const repo = await openRepo(repoId);
        await setRepoSetting(repo, 'name', info.name);
        await setRepoSetting(repo, 'backupKind', kind);
        const sb3 = await (await vm.saveProjectSb3()).arrayBuffer();
        await commitProject(repo, sb3, `Imported ${info.name}.sb3`, AUTHOR);
        if (thumbnail) await setSetting(thumbnailKey(repoId), thumbnail);
        return {current: {repoId, name: info.name, backupKind: kind, backupId: null}, branch: 'main'};
    }

    const bytes = new Uint8Array(data);
    const existing = (await listBrowserRepos()).find(r => r.backupKind === kind && r.backupId === info.id);
    let repoId;
    let repo;
    let diverged = [];
    if (existing) {
        repoId = existing.id;
        repo = await openRepo(repoId);
        ({diverged} = await syncFromBundle(repo, bytes, {moveCurrent: true}));
        if (diverged.includes(await currentBranch(repo))) {
            throw new BackupConflictError(
                `"${info.name}" in ${describeBackup(kind)} and the copy in this browser both have changes the ` +
                'other does not. Open the copy from "This browser" to keep working on it.'
            );
        }
    } else {
        repoId = newProjectId();
        repo = await cloneBundle(getBrowserGitFs(), repoDirFor(repoId), bytes);
    }
    await setRepoSetting(repo, 'name', info.name);
    await setRepoSetting(repo, 'backupKind', kind);
    await setRepoSetting(repo, 'backupId', info.id);
    // Only when every branch here includes the backup can the next save replace it without a check.
    if (diverged.length === 0) await setRepoSetting(repo, 'syncedToken', await bundleToken(bytes));
    if (thumbnail) await setSetting(thumbnailKey(repoId), thumbnail);
    await loadHead(vm, repo);
    return {
        current: {repoId, name: info.name, backupKind: kind, backupId: info.id},
        branch: await currentBranch(repo)
    };
};

/**
 * Move projects this browser kept as .sb3 files (before projects were kept in Git) into repositories.
 * @returns {Promise<void>} resolves when every old project has been moved.
 */
const migrateBrowserProjects = async () => {
    const legacy = legacyBrowserProjects();
    for (const project of await legacy.list()) {
        const repoId = newProjectId();
        const repo = await openRepo(repoId);
        await setRepoSetting(repo, 'name', project.name);
        await commitProject(repo, await legacy.load(project.id), 'Moved from this browser\'s old project list', AUTHOR);
        const thumbnail = await legacy.thumbnail(project.id);
        if (thumbnail) await setSetting(thumbnailKey(repoId), thumbnail);
        await legacy.remove(project.id);
    }
};

/**
 * The repositories in this browser that have at least one version, newest first.
 * @returns {Promise<RepoSummary[]>} the repositories.
 */
const listBrowserProjects = async () => {
    await migrateBrowserProjects();
    return (await listBrowserRepos()).filter(summary => summary.modified > 0);
};

/**
 * Delete a repository from this browser. Its backup, if any, is left alone.
 * @param {string} repoId - the repository.
 * @returns {Promise<void>} resolves when it is deleted.
 */
const deleteBrowserProject = async repoId => {
    await deleteBrowserRepo(repoId);
    await setSetting(thumbnailKey(repoId), null);
};

/**
 * Switch the current project to another branch and load that branch's latest version.
 * @param {VirtualMachine} vm - the VM.
 * @param {string} repoId - the repository.
 * @param {string} branch - the branch.
 * @returns {Promise<void>} resolves when the branch's project is loaded.
 */
const switchProjectBranch = async (vm, repoId, branch) => {
    await reloadProject(vm, await switchBranch(await openRepo(repoId), branch));
};

/**
 * Start a branch at the current version and switch to it (the project in the editor stays as it is).
 * @param {string} repoId - the repository.
 * @param {string} branch - the new branch's name.
 * @returns {Promise<void>} resolves when the branch exists and is current.
 */
const createProjectBranch = async (repoId, branch) => {
    await createBranch(await openRepo(repoId), branch);
};

/**
 * Stop backing up a repository (after its backup file was removed).
 * @param {string} repoId - the repository.
 * @returns {Promise<void>} resolves when the link is removed.
 */
const unlinkBackup = async repoId => {
    const repo = await openRepo(repoId);
    // An undefined value removes the setting.
    for (const key of ['backupKind', 'backupId', 'syncedToken']) await setRepoSetting(repo, key);
};

export {
    BackupConflictError,
    createProjectBranch,
    deleteBrowserProject,
    listBrowserProjects,
    openBrowserProject,
    openRepo,
    openStoredProject,
    repoThumbnail,
    saveProject,
    switchProjectBranch,
    unlinkBackup
};
