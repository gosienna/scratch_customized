// CUSTOM: the My Projects page, the version history and commit dialogs, the Git repository the current project
// is kept in, and where that repository is backed up.
import log from '../lib/log';

const OPEN_DIALOG = 'scratch-gui/project-storage/OPEN_DIALOG';
const CLOSE_DIALOG = 'scratch-gui/project-storage/CLOSE_DIALOG';
const SET_CURRENT = 'scratch-gui/project-storage/SET_CURRENT';
const SET_LAST_KIND = 'scratch-gui/project-storage/SET_LAST_KIND';
const SET_VCS_STATUS = 'scratch-gui/project-storage/SET_VCS_STATUS';
const SET_GOOGLE_ACCOUNT = 'scratch-gui/project-storage/SET_GOOGLE_ACCOUNT';
// Upstream actions that put a different project in the editor (File > New, File > Load from your computer).
const START_FETCHING_NEW = 'scratch-gui/project-state/START_FETCHING_NEW';
const START_LOADING_VM_FILE_UPLOAD = 'scratch-gui/project-state/START_LOADING_VM_FILE_UPLOAD';

const LAST_KIND_KEY = 'scratchCustomized.projectStorage.lastKind';
const STORE_KINDS = ['browser', 'folder', 'drive'];

const readLastKind = () => {
    try {
        const kind = window.localStorage.getItem(LAST_KIND_KEY);
        if (STORE_KINDS.includes(kind)) return kind;
    } catch (e) {
        // localStorage can be unavailable (e.g. privacy settings); fall back to the browser store.
    }
    return 'browser';
};

const initialState = {
    /** null when closed, otherwise 'projects' (My Projects), 'history' (version history) or 'commit'. */
    dialog: null,
    /**
     * The repository of the current project, or null before its first commit:
     * {repoId, name, backupKind, backupId}, where the backup fields are null when it is kept only in this browser.
     */
    current: null,
    /** The branch the next commit goes to, or null before the first commit. */
    branch: null,
    /** What the last commit or sync did, shown beside the Commit button: {message, error}, or null. */
    vcsStatus: null,
    /** The store the My Projects page showed last ('browser', 'folder' or 'drive'). */
    lastKind: typeof window === 'undefined' ? 'browser' : readLastKind(),
    /** The Google account signed in for Drive in this page, {name, email, photoUrl}, or null. */
    googleAccount: null
};

const reducer = function (state, action) {
    if (typeof state === 'undefined') state = initialState;
    switch (action.type) {
    case OPEN_DIALOG:
        return {...state, dialog: action.purpose};
    case CLOSE_DIALOG:
        return {...state, dialog: null};
    case SET_CURRENT:
        return {...state, current: action.current, branch: action.branch, vcsStatus: null};
    case SET_VCS_STATUS:
        return {...state, vcsStatus: action.status};
    case SET_LAST_KIND:
        return {...state, lastKind: action.kind};
    case SET_GOOGLE_ACCOUNT:
        return {...state, googleAccount: action.account};
    case START_FETCHING_NEW:
    case START_LOADING_VM_FILE_UPLOAD:
        // The editor now shows a project that is not in any repository yet.
        return {...state, current: null, branch: null, vcsStatus: null};
    default:
        return state;
    }
};

/**
 * @param {'projects'|'history'|'commit'} purpose - which page or dialog to open.
 * @returns {object} the action.
 */
const openProjectStorage = purpose => ({type: OPEN_DIALOG, purpose});
const closeProjectStorage = () => ({type: CLOSE_DIALOG});
/**
 * @param {?{repoId: string, name: string, backupKind: ?string, backupId: ?string}} current - the repository of
 * the current project.
 * @param {?string} branch - its current branch.
 * @returns {object} the action.
 */
const setStoredProject = (current, branch = null) => ({type: SET_CURRENT, current, branch});
/**
 * @param {?{message: string, error: boolean}} status - what the last commit or sync did.
 * @returns {object} the action.
 */
const setVcsStatus = status => ({type: SET_VCS_STATUS, status});
/**
 * Remember which store the My Projects page shows, also for the next visit.
 * @param {'browser'|'folder'|'drive'} kind - the store.
 * @returns {object} the action.
 */
const setLastStoreKind = kind => {
    try {
        window.localStorage.setItem(LAST_KIND_KEY, kind);
    } catch (e) {
        log.warn('setLastStoreKind: could not remember the store in localStorage', e);
    }
    return {type: SET_LAST_KIND, kind};
};
/**
 * @param {?{name: string, email: string, photoUrl: ?string}} account - the signed-in Google account.
 * @returns {object} the action.
 */
const setGoogleAccount = account => ({type: SET_GOOGLE_ACCOUNT, account});

export {
    reducer as default,
    initialState as projectStorageInitialState,
    openProjectStorage,
    closeProjectStorage,
    setStoredProject,
    setVcsStatus,
    setLastStoreKind,
    setGoogleAccount,
    STORE_KINDS
};
