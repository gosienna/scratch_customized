// CUSTOM: the My Projects page. Every project is a Git repository in this browser; a project can also be backed up,
// with its whole history, to a local folder or a Google Drive folder. Old .sb3 files there can be imported.
import PropTypes from 'prop-types';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {connect, useStore} from 'react-redux';
import {pickDriveFolder} from '@scratch-customized/platform';

import {getProjectStores, GOOGLE_PICKER_API_KEY, GOOGLE_APP_ID} from '../../lib/customized/project-stores';
import {
    deleteBrowserProject,
    listBrowserProjects,
    openBrowserProject,
    openStoredProject,
    repoThumbnail,
    saveProject,
    unlinkBackup
} from '../../lib/customized/project-repo';
import {
    closeProjectStorage,
    setLastStoreKind,
    setStoredProject,
    STORE_KINDS
} from '../../reducers/project-storage';
import {setProjectUnchanged} from '../../reducers/project-changed';
import {closeLoadingProject, openLoadingProject} from '../../reducers/modals';
import {setProjectTitle} from '../../reducers/project-title';
import log from '../../lib/log';
import sharedMessages from '../../lib/shared-messages';

import styles from './project-library.css';

const messages = defineMessages({
    title: {id: 'gui.customized.library.title', defaultMessage: 'My Projects', description: 'Page title'},
    back: {id: 'gui.customized.library.back', defaultMessage: 'Back to editor', description: 'Button'},
    browser: {id: 'gui.customized.storage.browser', defaultMessage: 'This browser', description: 'Store tab'},
    folder: {
        id: 'gui.customized.storage.folder',
        defaultMessage: 'Folder on this computer',
        description: 'Store tab'
    },
    drive: {id: 'gui.customized.storage.drive', defaultMessage: 'Google Drive', description: 'Store tab'},
    browserHint: {
        id: 'gui.customized.storage.browserHint',
        defaultMessage: 'Every project, with all its versions, is kept in this browser. Clearing site data ' +
            'removes them, so back up important projects to a folder or Google Drive.',
        description: 'Explains browser storage'
    },
    folderLocation: {
        id: 'gui.customized.library.folderLocation',
        defaultMessage: 'Folder: "{name}"',
        description: 'Which local folder the projects are in'
    },
    driveLocation: {
        id: 'gui.customized.library.driveLocation',
        defaultMessage: 'Google Drive folder: "{name}"',
        description: 'Which Google Drive folder the projects are in'
    },
    change: {
        id: 'gui.customized.library.change',
        defaultMessage: 'Change…',
        description: 'Button: pick another folder'
    },
    folderUnsupported: {
        id: 'gui.customized.storage.folderUnsupported',
        defaultMessage: 'This browser cannot open folders. Use Chrome or Edge, or File > Save to your computer.',
        description: 'Folder storage unavailable'
    },
    choosePrompt: {
        id: 'gui.customized.library.choosePrompt',
        defaultMessage: 'Choose a folder on this computer to keep your projects in.',
        description: 'Asks the user to pick a local folder'
    },
    allowPrompt: {
        id: 'gui.customized.library.allowPrompt',
        defaultMessage: 'The browser needs your permission again to use the folder "{name}".',
        description: 'Asks the user to grant access to the remembered folder again'
    },
    chooseFolder: {
        id: 'gui.customized.storage.chooseFolder',
        defaultMessage: 'Choose a folder…',
        description: 'Button'
    },
    allowFolder: {
        id: 'gui.customized.storage.allowFolder',
        defaultMessage: 'Allow access to "{name}"',
        description: 'Button to grant access to the remembered folder again'
    },
    driveUnconfigured: {
        id: 'gui.customized.storage.driveUnconfigured',
        defaultMessage: 'Google Drive is not set up for this site (no GOOGLE_CLIENT_ID at build time).',
        description: 'Drive storage unavailable'
    },
    signInPrompt: {
        id: 'gui.customized.library.signInPrompt',
        defaultMessage: 'Link your Google Drive to keep projects in a Drive folder, also one shared with you.',
        description: 'Asks the user to sign in to Google Drive'
    },
    signIn: {id: 'gui.customized.storage.signIn', defaultMessage: 'Sign in with Google', description: 'Button'},
    linkPrompt: {
        id: 'gui.customized.library.linkPrompt',
        defaultMessage: 'Which Google Drive folder should your projects go in? Paste its link, or choose it.',
        description: 'Asks the user to link a Drive folder'
    },
    folderLink: {
        id: 'gui.customized.library.folderLink',
        defaultMessage: 'Folder link',
        description: 'Label of the input for a Google Drive folder link'
    },
    useFolder: {id: 'gui.customized.library.useFolder', defaultMessage: 'Use this folder', description: 'Button'},
    pickFolder: {
        id: 'gui.customized.library.pickFolder',
        defaultMessage: 'Choose from Google Drive…',
        description: 'Button that opens Google Picker'
    },
    pickerTitle: {
        id: 'gui.customized.library.pickerTitle',
        defaultMessage: 'Choose a folder for your projects',
        description: 'Title of the Google Drive folder picker'
    },
    cancel: {id: 'gui.customized.library.cancel', defaultMessage: 'Cancel', description: 'Button'},
    empty: {id: 'gui.customized.storage.empty', defaultMessage: 'No projects here yet.', description: 'Empty list'},
    loading: {id: 'gui.customized.storage.loading', defaultMessage: 'Loading…', description: 'Loading list'},
    openProject: {
        id: 'gui.customized.library.openProject',
        defaultMessage: 'Open "{name}"',
        description: 'Accessible label of a project card'
    },
    oldFormat: {
        id: 'gui.customized.library.oldFormat',
        defaultMessage: 'Old .sb3 — opens as a new project',
        description: 'Badge on a project card for a .sb3 file, which is imported into a Git repository when opened'
    },
    backedUp: {
        id: 'gui.customized.library.backedUp',
        defaultMessage: 'Backed up to {place}',
        description: 'Project card in This browser: where the project\'s history is also kept'
    },
    folderPlace: {id: 'gui.customized.library.folderPlace', defaultMessage: 'a folder', description: 'Backup place'},
    remove: {id: 'gui.customized.storage.remove', defaultMessage: 'Delete', description: 'Button'},
    trash: {id: 'gui.customized.storage.trash', defaultMessage: 'Move to trash', description: 'Button (Drive)'},
    nameLabel: {id: 'gui.customized.storage.nameLabel', defaultMessage: 'Project name', description: 'Label'},
    saveHere: {
        id: 'gui.customized.library.saveHere',
        defaultMessage: 'Save here',
        description: 'Button: save the current project and back up its history in this folder or Drive folder'
    },
    save: {
        id: 'gui.customized.library.save',
        defaultMessage: 'Save',
        description: 'Button: replace the stored copy of the current project'
    },
    saveNew: {id: 'gui.customized.storage.saveNew', defaultMessage: 'Save as new project', description: 'Button'},
    confirmRemoveRepo: {
        id: 'gui.customized.library.confirmRemoveRepo',
        defaultMessage: 'Delete "{name}" and all its versions from this browser? This cannot be undone. ' +
            'A backup in a folder or Google Drive is kept.',
        description: 'Confirm deleting a project repository from the browser'
    },
    confirmRemove: {
        id: 'gui.customized.storage.confirmRemove',
        defaultMessage: 'Delete "{name}"? This cannot be undone.',
        description: 'Confirm permanent deletion'
    },
    confirmTrash: {
        id: 'gui.customized.storage.confirmTrash',
        defaultMessage: 'Move "{name}" to the Google Drive trash?',
        description: 'Confirm moving to Drive trash'
    },
    saved: {id: 'gui.customized.storage.saved', defaultMessage: 'Saved "{name}".', description: 'Status'},
    upToDate: {
        id: 'gui.customized.library.upToDate',
        defaultMessage: '"{name}" has no changes since its last version.',
        description: 'Status after saving when nothing changed'
    },
    savedNotBackedUp: {
        id: 'gui.customized.library.savedNotBackedUp',
        defaultMessage: 'Saved "{name}" in this browser, but not backed up: {error}',
        description: 'Status when the commit worked and the upload to a folder or Drive did not'
    }
});

/**
 * A stable event handler that always calls the latest `handler`, so buttons do not re-render on every change.
 * @param {Function} handler - the current handler.
 * @returns {Function} a stable function that forwards to it.
 */
const useCallbackRef = handler => {
    const ref = useRef(handler);
    ref.current = handler;
    return useCallback((...args) => ref.current(...args), []);
};

/** What a store needs before it can list projects, as found by `refresh`. */
const SETUP = {
    READY: 'ready',
    UNAVAILABLE: 'unavailable',
    CHOOSE_FOLDER: 'chooseFolder',
    ALLOW_FOLDER: 'allowFolder',
    SIGN_IN: 'signIn',
    LINK_DRIVE_FOLDER: 'linkDriveFolder'
};

const Thumbnail = ({loadThumbnail, project}) => {
    const [url, setUrl] = useState(null);
    useEffect(() => {
        let objectUrl = null;
        let cancelled = false;
        loadThumbnail(project.id).then(
            blob => {
                if (cancelled || !blob) return;
                objectUrl = URL.createObjectURL(blob);
                setUrl(objectUrl);
            },
            e => log.warn(`Thumbnail: could not load the thumbnail of project ${project.id}`, e)
        );
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [loadThumbnail, project.id, project.modified]);
    return url ? (
        <img
            className={styles.thumbnail}
            src={url}
            alt=""
            draggable={false}
        />
    ) : (
        <div
            className={styles.placeholder}
            aria-hidden="true"
        >
            {project.name.trim().charAt(0)
                .toUpperCase()}
        </div>
    );
};

Thumbnail.propTypes = {
    loadThumbnail: PropTypes.func.isRequired,
    project: PropTypes.shape({id: PropTypes.string, name: PropTypes.string, modified: PropTypes.number}).isRequired
};

const ProjectLibrary = ({
    current,
    initialKind,
    projectTitle,
    projectChanged,
    vm,
    onClose,
    onKindChange,
    onStored
}) => {
    const intl = useIntl();
    const store = useStore();
    const stores = getProjectStores();
    const [kind, setKind] = useState(initialKind);
    const [setup, setSetup] = useState(null);
    const [location, setLocation] = useState(null);
    const [linkingDrive, setLinkingDrive] = useState(false);
    const [folderLink, setFolderLink] = useState('');
    const [projects, setProjects] = useState(null);
    const [error, setError] = useState(null);
    const [status, setStatus] = useState(null);
    const [busy, setBusy] = useState(false);
    const [name, setName] = useState(projectTitle);
    /** The folder or Drive store; null on the This browser tab, which lists repositories instead. */
    const activeStore = kind === 'browser' ? null : stores[kind];
    /** Counts refreshes, so one that finishes after a newer one (e.g. after switching tabs) is dropped. */
    const refreshCount = useRef(0);

    const listProjects = () => (kind === 'browser' ? listBrowserProjects() : activeStore.list());

    /** Find out what the store needs, then list its projects if it is ready. */
    const inspect = async () => {
        if (kind === 'browser') return {setup: SETUP.READY, projects: await listProjects()};
        if (!activeStore || !activeStore.isSupported()) return {setup: SETUP.UNAVAILABLE};
        if (kind === 'folder') {
            const folderName = await activeStore.folderName();
            if (!await activeStore.isConnected()) {
                return {setup: folderName ? SETUP.ALLOW_FOLDER : SETUP.CHOOSE_FOLDER, location: folderName};
            }
            return {setup: SETUP.READY, location: folderName, projects: await listProjects()};
        }
        const folder = await activeStore.folder();
        if (!await activeStore.isConnected()) return {setup: SETUP.SIGN_IN, location: folder?.name};
        if (!folder) return {setup: SETUP.LINK_DRIVE_FOLDER};
        return {setup: SETUP.READY, location: folder.name, projects: await listProjects()};
    };

    const refresh = useCallbackRef(async () => {
        const count = ++refreshCount.current;
        setError(null);
        setProjects(null);
        setSetup(null);
        try {
            const found = await inspect();
            if (count !== refreshCount.current) return;
            setSetup(found.setup);
            setLocation(found.location ?? null);
            setProjects(found.projects ?? null);
        } catch (e) {
            if (count === refreshCount.current) {
                // The tab still offers its setup actions (e.g. Change… for a folder that is now in the trash).
                setSetup(SETUP.READY);
                setProjects([]);
                setError(e.message);
            }
        }
    });

    useEffect(() => {
        refresh();
    }, [kind, refresh]);

    useEffect(() => {
        const handleKeyDown = event => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const run = async action => {
        setBusy(true);
        setError(null);
        setStatus(null);
        try {
            await action();
        } catch (e) {
            log.warn(`ProjectLibrary: ${kind} action failed`, e);
            setError(e.message);
        } finally {
            setBusy(false);
        }
    };

    const handleConnect = useCallbackRef(() => run(async () => {
        await activeStore.connect();
        await refresh();
    }));

    const handleChangeFolder = useCallbackRef(() => {
        if (kind === 'drive') {
            setLinkingDrive(true);
            return;
        }
        run(async () => {
            await activeStore.chooseFolder();
            await refresh();
        });
    });

    const linkDriveFolder = async idOrUrl => {
        await activeStore.linkFolder(idOrUrl);
        setLinkingDrive(false);
        setFolderLink('');
        await refresh();
    };

    const handleFolderLinkChange = useCallbackRef(event => setFolderLink(event.target.value));
    const handleUseFolderLink = useCallbackRef(event => {
        event.preventDefault();
        run(() => linkDriveFolder(folderLink));
    });
    const handlePickDriveFolder = useCallbackRef(() => run(async () => {
        const folder = await pickDriveFolder({
            token: await activeStore.accessToken(),
            apiKey: GOOGLE_PICKER_API_KEY,
            appId: GOOGLE_APP_ID,
            title: intl.formatMessage(messages.pickerTitle)
        });
        if (folder) await linkDriveFolder(folder.id);
    }));
    const handleCancelLinking = useCallbackRef(() => setLinkingDrive(false));

    const handleOpen = project => run(async () => {
        const question = intl.formatMessage(sharedMessages.replaceProjectWarning);
        if (projectChanged && !confirm(question)) return; // eslint-disable-line no-alert
        // The project server's loading states are not involved: the project stays "showing without ID", as after
        // File > Load from your computer.
        store.dispatch(openLoadingProject());
        let opened;
        try {
            opened = kind === 'browser' ?
                await openBrowserProject(vm, project) :
                await openStoredProject(vm, kind, project);
            store.dispatch(setProjectTitle(opened.current.name));
            store.dispatch(setProjectUnchanged());
        } finally {
            store.dispatch(closeLoadingProject());
        }
        onStored(opened.current, opened.branch);
        onClose();
    });

    /** Save the current project here, or (`asNew`) as a new project. */
    const save = asNew => run(async () => {
        const projectName = name.trim();
        const result = await saveProject({
            vm,
            current,
            name: projectName,
            asNew,
            // This browser keeps a project's backup where it is; a folder or Drive tab backs it up there.
            ...(kind === 'browser' ? (asNew && {backupKind: null}) : {backupKind: kind})
        });
        store.dispatch(setProjectTitle(projectName));
        store.dispatch(setProjectUnchanged());
        onStored(result.current, result.branch);
        setName(projectName);
        if (result.backupError) {
            setError(intl.formatMessage(messages.savedNotBackedUp, {
                name: projectName,
                error: result.backupError.message
            }));
        } else {
            setStatus(intl.formatMessage(result.committed ? messages.saved : messages.upToDate, {name: projectName}));
        }
        setProjects(await listProjects());
    });

    const isCurrent = project => Boolean(current) && (kind === 'browser' ?
        current.repoId === project.id :
        current.backupKind === kind && current.backupId === project.id);

    const handleRemove = project => {
        const message = {
            browser: messages.confirmRemoveRepo,
            folder: messages.confirmRemove,
            drive: messages.confirmTrash
        };
        if (!confirm(intl.formatMessage(message[kind], {name: project.name}))) return; // eslint-disable-line no-alert
        run(async () => {
            if (kind === 'browser') {
                await deleteBrowserProject(project.id);
                if (isCurrent(project)) onStored(null);
            } else {
                await activeStore.remove(project.id);
                if (isCurrent(project)) {
                    await unlinkBackup(current.repoId);
                    onStored({...current, backupKind: null, backupId: null}, null);
                }
            }
            setProjects(await listProjects());
        });
    };

    const loadThumbnail = useCallbackRef(id => (kind === 'browser' ? repoThumbnail(id) : activeStore.thumbnail(id)));
    const projectFromEvent = event => projects.find(project => project.id === event.currentTarget.dataset.id);
    const handleOpenClick = useCallbackRef(event => handleOpen(projectFromEvent(event)));
    const handleRemoveClick = useCallbackRef(event => handleRemove(projectFromEvent(event)));
    const handleTabClick = useCallbackRef(event => {
        const nextKind = event.currentTarget.dataset.kind;
        setStatus(null);
        setLinkingDrive(false);
        setKind(nextKind);
        onKindChange(nextKind);
    });
    const handleNameChange = useCallbackRef(event => setName(event.target.value));
    const handleSaveCurrentClick = useCallbackRef(() => save(false));
    const handleSaveNewClick = useCallbackRef(() => save(true));

    const renderDriveLink = () => (
        <div className={styles.setup}>
            <p>{intl.formatMessage(messages.linkPrompt)}</p>
            <form
                className={styles.linkRow}
                onSubmit={handleUseFolderLink}
            >
                <input
                    aria-label={intl.formatMessage(messages.folderLink)}
                    placeholder="https://drive.google.com/drive/folders/…"
                    value={folderLink}
                    onChange={handleFolderLinkChange}
                />
                <button
                    type="submit"
                    className={styles.primaryButton}
                    disabled={busy || !folderLink.trim()}
                >
                    {intl.formatMessage(messages.useFolder)}
                </button>
            </form>
            <div className={styles.linkRow}>
                {GOOGLE_PICKER_API_KEY && (
                    <button
                        className={styles.secondaryButton}
                        disabled={busy}
                        onClick={handlePickDriveFolder}
                    >
                        {intl.formatMessage(messages.pickFolder)}
                    </button>
                )}
                {linkingDrive && (
                    <button
                        className={styles.secondaryButton}
                        disabled={busy}
                        onClick={handleCancelLinking}
                    >
                        {intl.formatMessage(messages.cancel)}
                    </button>
                )}
            </div>
        </div>
    );

    const renderSetup = () => {
        if (setup === SETUP.UNAVAILABLE) {
            return (
                <p className={styles.setup}>
                    {intl.formatMessage(kind === 'drive' ? messages.driveUnconfigured : messages.folderUnsupported)}
                </p>
            );
        }
        if (setup === SETUP.LINK_DRIVE_FOLDER) return renderDriveLink();
        const prompts = {
            [SETUP.CHOOSE_FOLDER]: [messages.choosePrompt, messages.chooseFolder],
            [SETUP.ALLOW_FOLDER]: [messages.allowPrompt, messages.allowFolder],
            [SETUP.SIGN_IN]: [messages.signInPrompt, messages.signIn]
        };
        const [prompt, button] = prompts[setup];
        return (
            <div className={styles.setup}>
                <p>{intl.formatMessage(prompt, {name: location})}</p>
                <button
                    className={styles.primaryButton}
                    disabled={busy}
                    onClick={handleConnect}
                >
                    {intl.formatMessage(button, {name: location})}
                </button>
            </div>
        );
    };

    const renderLocation = () => {
        if (kind === 'browser') return <p className={styles.hint}>{intl.formatMessage(messages.browserHint)}</p>;
        return (
            <p className={styles.hint}>
                {intl.formatMessage(kind === 'drive' ? messages.driveLocation : messages.folderLocation, {
                    name: location
                })}
                <button
                    className={styles.linkButton}
                    disabled={busy}
                    onClick={handleChangeFolder}
                >
                    {intl.formatMessage(messages.change)}
                </button>
            </p>
        );
    };

    const renderSaveBar = () => (
        <div className={styles.saveBar}>
            <label className={styles.nameField}>
                {intl.formatMessage(messages.nameLabel)}
                <input
                    value={name}
                    onChange={handleNameChange}
                />
            </label>
            {current && (
                <button
                    className={styles.primaryButton}
                    disabled={busy || !name.trim()}
                    onClick={handleSaveCurrentClick}
                >
                    {intl.formatMessage(kind === 'browser' || current.backupKind === kind ?
                        messages.save : messages.saveHere)}
                </button>
            )}
            <button
                className={current ? styles.secondaryButton : styles.primaryButton}
                disabled={busy || !name.trim()}
                onClick={handleSaveNewClick}
            >
                {intl.formatMessage(messages.saveNew)}
            </button>
        </div>
    );

    const renderGrid = () => {
        if (!projects) return <p className={styles.hint}>{intl.formatMessage(messages.loading)}</p>;
        if (projects.length === 0) return <p className={styles.hint}>{intl.formatMessage(messages.empty)}</p>;
        return (
            <ul className={styles.grid}>
                {projects.map(project => (
                    <li
                        key={project.id}
                        className={isCurrent(project) ? styles.currentCard : styles.card}
                    >
                        <button
                            className={styles.cardOpen}
                            data-id={project.id}
                            disabled={busy}
                            onClick={handleOpenClick}
                            aria-label={intl.formatMessage(messages.openProject, {name: project.name})}
                        >
                            <Thumbnail
                                loadThumbnail={loadThumbnail}
                                project={project}
                            />
                            <span className={styles.cardName}>{project.name}</span>
                            <span className={styles.cardMeta}>{new Date(project.modified).toLocaleString()}</span>
                            {project.format === 'sb3' && (
                                <span className={styles.cardBadge}>{intl.formatMessage(messages.oldFormat)}</span>
                            )}
                            {project.backupKind && (
                                <span className={styles.cardMeta}>
                                    {intl.formatMessage(messages.backedUp, {
                                        place: intl.formatMessage(project.backupKind === 'drive' ?
                                            messages.drive : messages.folderPlace)
                                    })}
                                </span>
                            )}
                        </button>
                        <div className={styles.cardActions}>
                            <button
                                data-id={project.id}
                                disabled={busy}
                                onClick={handleRemoveClick}
                            >
                                {intl.formatMessage(kind === 'drive' ? messages.trash : messages.remove)}
                            </button>
                        </div>
                    </li>
                ))}
            </ul>
        );
    };

    const ready = setup === SETUP.READY && !linkingDrive;
    return (
        <div
            className={styles.page}
            role="dialog"
            aria-modal="true"
            aria-label={intl.formatMessage(messages.title)}
        >
            <header className={styles.header}>
                <h2 className={styles.title}>{intl.formatMessage(messages.title)}</h2>
                <button
                    className={styles.backButton}
                    onClick={onClose}
                >
                    {intl.formatMessage(messages.back)}
                </button>
            </header>
            <div className={styles.content}>
                <div
                    className={styles.tabs}
                    role="tablist"
                >
                    {STORE_KINDS.map(storeKind => (
                        <button
                            key={storeKind}
                            role="tab"
                            aria-selected={storeKind === kind}
                            className={storeKind === kind ? styles.activeTab : styles.tab}
                            data-kind={storeKind}
                            onClick={handleTabClick}
                        >
                            {intl.formatMessage(messages[storeKind])}
                        </button>
                    ))}
                </div>
                {ready && renderLocation()}
                {linkingDrive && renderDriveLink()}
                {setup && setup !== SETUP.READY && renderSetup()}
                {ready && renderSaveBar()}
                {status && <p className={styles.status}>{status}</p>}
                {error && <p className={styles.error}>{error}</p>}
                {ready && renderGrid()}
            </div>
        </div>
    );
};

ProjectLibrary.propTypes = {
    current: PropTypes.shape({
        repoId: PropTypes.string,
        name: PropTypes.string,
        backupKind: PropTypes.string,
        backupId: PropTypes.string
    }),
    initialKind: PropTypes.oneOf(STORE_KINDS).isRequired,
    projectTitle: PropTypes.string,
    projectChanged: PropTypes.bool,
    vm: PropTypes.shape({loadProject: PropTypes.func, saveProjectSb3: PropTypes.func}).isRequired,
    onClose: PropTypes.func.isRequired,
    onKindChange: PropTypes.func.isRequired,
    onStored: PropTypes.func.isRequired
};

/* eslint-disable react/prop-types -- props of the connected wrapper, passed straight through. */
const ProjectLibraryWrapper = ({open, ...props}) => (open ? <ProjectLibrary {...props} /> : null);
/* eslint-enable react/prop-types */

const mapStateToProps = state => ({
    open: state.scratchGui.projectStorage.dialog === 'projects',
    current: state.scratchGui.projectStorage.current,
    initialKind: state.scratchGui.projectStorage.lastKind,
    projectTitle: state.scratchGui.projectTitle,
    projectChanged: state.scratchGui.projectChanged,
    vm: state.scratchGui.vm
});

const mapDispatchToProps = dispatch => ({
    onClose: () => dispatch(closeProjectStorage()),
    onKindChange: kind => dispatch(setLastStoreKind(kind)),
    onStored: (current, branch) => dispatch(setStoredProject(current, branch))
});

export default connect(mapStateToProps, mapDispatchToProps)(ProjectLibraryWrapper);
