// CUSTOM: open and save projects in the browser, a local folder, or Google Drive.
import PropTypes from 'prop-types';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {connect, useStore} from 'react-redux';

import Modal from '../modal.jsx';
import {getProjectStores} from '../../lib/customized/project-stores';
import {closeProjectStorage, setStoredProject} from '../../reducers/project-storage';
import {setProjectUnchanged} from '../../reducers/project-changed';
import {closeLoadingProject, openLoadingProject} from '../../reducers/modals';
import {setProjectTitle} from '../../reducers/project-title';
import sharedMessages from '../../lib/shared-messages';

import styles from './project-storage-modal.css';

const messages = defineMessages({
    openTitle: {id: 'gui.customized.storage.openTitle', defaultMessage: 'Open a project', description: 'Title'},
    saveTitle: {id: 'gui.customized.storage.saveTitle', defaultMessage: 'Save the project', description: 'Title'},
    browser: {id: 'gui.customized.storage.browser', defaultMessage: 'This browser', description: 'Store tab'},
    folder: {id: 'gui.customized.storage.folder', defaultMessage: 'Folder on this computer', description: 'Store tab'},
    drive: {id: 'gui.customized.storage.drive', defaultMessage: 'Google Drive', description: 'Store tab'},
    browserHint: {
        id: 'gui.customized.storage.browserHint',
        defaultMessage: 'Kept in this browser only. Clearing site data removes them.',
        description: 'Explains browser storage'
    },
    folderUnsupported: {
        id: 'gui.customized.storage.folderUnsupported',
        defaultMessage: 'This browser cannot open folders. Use Chrome or Edge, or File > Save to your computer.',
        description: 'Folder storage unavailable'
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
    signIn: {id: 'gui.customized.storage.signIn', defaultMessage: 'Sign in with Google', description: 'Button'},
    empty: {id: 'gui.customized.storage.empty', defaultMessage: 'No projects here yet.', description: 'Empty list'},
    loading: {id: 'gui.customized.storage.loading', defaultMessage: 'Loading…', description: 'Loading list'},
    open: {id: 'gui.customized.storage.open', defaultMessage: 'Open', description: 'Button'},
    overwrite: {id: 'gui.customized.storage.overwrite', defaultMessage: 'Save over this', description: 'Button'},
    remove: {id: 'gui.customized.storage.remove', defaultMessage: 'Delete', description: 'Button'},
    trash: {id: 'gui.customized.storage.trash', defaultMessage: 'Move to trash', description: 'Button (Drive)'},
    nameLabel: {id: 'gui.customized.storage.nameLabel', defaultMessage: 'Project name', description: 'Label'},
    saveNew: {id: 'gui.customized.storage.saveNew', defaultMessage: 'Save as new project', description: 'Button'},
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
    confirmOverwrite: {
        id: 'gui.customized.storage.confirmOverwrite',
        defaultMessage: 'Replace "{name}" with the current project?',
        description: 'Confirm overwrite'
    },
    saved: {id: 'gui.customized.storage.saved', defaultMessage: 'Saved "{name}".', description: 'Status'}
});

const STORE_KINDS = ['browser', 'folder', 'drive'];

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

const formatSize = bytes => (typeof bytes === 'number' ? `${Math.max(1, Math.round(bytes / 1024))} KB` : '');

const ProjectStorageModal = ({
    purpose,
    current,
    projectTitle,
    projectChanged,
    vm,
    onClose,
    onStored
}) => {
    const intl = useIntl();
    const store = useStore();
    const stores = getProjectStores();
    const [kind, setKind] = useState(current?.kind ?? 'browser');
    const [connected, setConnected] = useState(false);
    const [folderName, setFolderName] = useState(null);
    const [projects, setProjects] = useState(null);
    const [error, setError] = useState(null);
    const [status, setStatus] = useState(null);
    const [busy, setBusy] = useState(false);
    const [name, setName] = useState(projectTitle);
    const activeStore = stores[kind];

    const refresh = useCallback(async () => {
        setError(null);
        setProjects(null);
        if (!activeStore || !activeStore.isSupported()) {
            setConnected(false);
            return;
        }
        if (activeStore.folderName) setFolderName(await activeStore.folderName());
        const isConnected = await activeStore.isConnected();
        setConnected(isConnected);
        if (isConnected) setProjects(await activeStore.list());
    }, [activeStore]);

    useEffect(() => {
        refresh().catch(e => setError(e.message));
    }, [refresh]);

    const run = async action => {
        setBusy(true);
        setError(null);
        setStatus(null);
        try {
            await action();
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    };

    const handleConnect = useCallbackRef(() => run(async () => {
        await activeStore.connect();
        await refresh();
    }));

    const handleOpen = project => run(async () => {
        const replaceWarning = intl.formatMessage(sharedMessages.replaceProjectWarning);
        if (projectChanged && !confirm(replaceWarning)) return; // eslint-disable-line no-alert
        const data = await activeStore.load(project.id);
        // The project server's loading states are not involved: the project stays "showing without ID", as after
        // File > Load from your computer.
        store.dispatch(openLoadingProject());
        try {
            await vm.loadProject(data);
            store.dispatch(setProjectTitle(project.name));
            store.dispatch(setProjectUnchanged());
        } finally {
            store.dispatch(closeLoadingProject());
        }
        onStored({kind, id: project.id, name: project.name});
        onClose();
    });

    const save = (projectName, id) => run(async () => {
        const sb3 = await vm.saveProjectSb3();
        const info = await activeStore.save(projectName, await sb3.arrayBuffer(), id);
        store.dispatch(setProjectTitle(info.name));
        store.dispatch(setProjectUnchanged());
        onStored({kind, id: info.id, name: info.name});
        setStatus(intl.formatMessage(messages.saved, {name: info.name}));
        await refresh();
    });

    const projectFromEvent = event => projects.find(project => project.id === event.currentTarget.dataset.id);
    const handleOpenClick = useCallbackRef(event => handleOpen(projectFromEvent(event)));
    const handleOverwriteClick = useCallbackRef(event => handleOverwrite(projectFromEvent(event)));
    const handleRemoveClick = useCallbackRef(event => handleRemove(projectFromEvent(event)));
    const handleTabClick = useCallbackRef(event => {
        setStatus(null);
        setKind(event.currentTarget.dataset.kind);
    });
    const handleNameChange = useCallbackRef(event => setName(event.target.value));
    const handleSaveNewClick = useCallbackRef(() => save(name.trim()));

    const handleOverwrite = project => {
        const question = intl.formatMessage(messages.confirmOverwrite, {name: project.name});
        if (!confirm(question)) return; // eslint-disable-line no-alert
        save(project.name, project.id);
    };

    const handleRemove = project => {
        const message = kind === 'drive' ? messages.confirmTrash : messages.confirmRemove;
        if (!confirm(intl.formatMessage(message, {name: project.name}))) return; // eslint-disable-line no-alert
        run(async () => {
            await activeStore.remove(project.id);
            if (current?.kind === kind && current.id === project.id) onStored(null);
            await refresh();
        });
    };

    const renderConnect = () => {
        if (kind === 'drive' && !activeStore) return <p>{intl.formatMessage(messages.driveUnconfigured)}</p>;
        if (kind === 'folder' && !activeStore.isSupported()) {
            return <p>{intl.formatMessage(messages.folderUnsupported)}</p>;
        }
        let label = messages.signIn;
        if (kind === 'folder') label = folderName ? messages.allowFolder : messages.chooseFolder;
        return (
            <button
                className={styles.primaryButton}
                disabled={busy}
                onClick={handleConnect}
            >
                {intl.formatMessage(label, {name: folderName})}
            </button>
        );
    };

    const renderList = () => {
        if (!projects) return <p className={styles.hint}>{intl.formatMessage(messages.loading)}</p>;
        if (projects.length === 0) return <p className={styles.hint}>{intl.formatMessage(messages.empty)}</p>;
        return (
            <ul className={styles.projectList}>
                {projects.map(project => (
                    <li
                        key={project.id}
                        className={styles.projectRow}
                    >
                        <span className={styles.projectName}>{project.name}</span>
                        <span className={styles.projectMeta}>
                            {new Date(project.modified).toLocaleString()} {formatSize(project.size)}
                        </span>
                        {purpose === 'open' ? (
                            <button
                                data-id={project.id}
                                disabled={busy}
                                onClick={handleOpenClick}
                            >
                                {intl.formatMessage(messages.open)}
                            </button>
                        ) : (
                            <button
                                data-id={project.id}
                                disabled={busy}
                                onClick={handleOverwriteClick}
                            >
                                {intl.formatMessage(messages.overwrite)}
                            </button>
                        )}
                        <button
                            data-id={project.id}
                            disabled={busy}
                            onClick={handleRemoveClick}
                        >
                            {intl.formatMessage(kind === 'drive' ? messages.trash : messages.remove)}
                        </button>
                    </li>
                ))}
            </ul>
        );
    };

    return (
        <Modal
            className={styles.modal}
            contentLabel={intl.formatMessage(purpose === 'open' ? messages.openTitle : messages.saveTitle)}
            onRequestClose={onClose}
            id="projectStorageModal"
        >
            <div className={styles.body}>
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
                {kind === 'browser' && <p className={styles.hint}>{intl.formatMessage(messages.browserHint)}</p>}
                {connected ? renderList() : renderConnect()}
                {purpose === 'save' && connected && (
                    <div className={styles.saveRow}>
                        <label>
                            {intl.formatMessage(messages.nameLabel)}
                            <input
                                value={name}
                                onChange={handleNameChange}
                            />
                        </label>
                        <button
                            className={styles.primaryButton}
                            disabled={busy || !name.trim()}
                            onClick={handleSaveNewClick}
                        >
                            {intl.formatMessage(messages.saveNew)}
                        </button>
                    </div>
                )}
                {status && <p className={styles.status}>{status}</p>}
                {error && <p className={styles.error}>{error}</p>}
            </div>
        </Modal>
    );
};

ProjectStorageModal.propTypes = {
    purpose: PropTypes.oneOf(['open', 'save']).isRequired,
    current: PropTypes.shape({kind: PropTypes.string, id: PropTypes.string, name: PropTypes.string}),
    projectTitle: PropTypes.string,
    projectChanged: PropTypes.bool,
    vm: PropTypes.shape({loadProject: PropTypes.func, saveProjectSb3: PropTypes.func}).isRequired,
    onClose: PropTypes.func.isRequired,
    onStored: PropTypes.func.isRequired
};

/* eslint-disable react/prop-types -- props of the connected wrapper, passed straight through. */
const ProjectStorageModalWrapper = ({purpose, ...props}) => (purpose === 'open' || purpose === 'save' ? (
    <ProjectStorageModal
        purpose={purpose}
        {...props}
    />
) : null);
/* eslint-enable react/prop-types */

const mapStateToProps = state => ({
    purpose: state.scratchGui.projectStorage.dialog,
    current: state.scratchGui.projectStorage.current,
    projectTitle: state.scratchGui.projectTitle,
    projectChanged: state.scratchGui.projectChanged,
    vm: state.scratchGui.vm
});

const mapDispatchToProps = dispatch => ({
    onClose: () => dispatch(closeProjectStorage()),
    onStored: current => dispatch(setStoredProject(current))
});

export default connect(mapStateToProps, mapDispatchToProps)(ProjectStorageModalWrapper);
