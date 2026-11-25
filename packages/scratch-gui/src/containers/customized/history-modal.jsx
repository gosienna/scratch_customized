// CUSTOM: version history (Git) for the current project — save versions, compare, restore, branch, push.
import PropTypes from 'prop-types';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {connect} from 'react-redux';
import {
    commitProject,
    createBranch,
    currentBranch,
    diffVersions,
    getBrowserGitFs,
    listBranches,
    listVersions,
    openProjectRepo,
    pushToRemote,
    readVersion,
    repoDirFor,
    switchBranch
} from '@scratch-customized/platform';

import Modal from '../modal.jsx';
import {reloadProject} from '../../lib/customized/reload-project';
import {closeProjectStorage} from '../../reducers/project-storage';
import {setProjectChanged} from '../../reducers/project-changed';

import styles from './history-modal.css';

const DEFAULT_CORS_PROXY = process.env.GIT_CORS_PROXY || 'https://cors.isomorphic-git.org';
const AUTHOR = {name: 'Scratch Customized user'};

const messages = defineMessages({
    title: {id: 'gui.customized.history.title', defaultMessage: 'Version history', description: 'Title'},
    branch: {id: 'gui.customized.history.branch', defaultMessage: 'Branch', description: 'Label'},
    newBranch: {id: 'gui.customized.history.newBranch', defaultMessage: 'New branch…', description: 'Button'},
    newBranchPrompt: {
        id: 'gui.customized.history.newBranchPrompt',
        defaultMessage: 'Name of the new branch (it starts from the latest saved version):',
        description: 'Prompt'
    },
    message: {id: 'gui.customized.history.message', defaultMessage: 'What did you change?', description: 'Label'},
    save: {id: 'gui.customized.history.save', defaultMessage: 'Save version', description: 'Button'},
    nothingChanged: {
        id: 'gui.customized.history.nothingChanged',
        defaultMessage: 'Nothing changed since the last version.',
        description: 'Status'
    },
    saved: {id: 'gui.customized.history.saved', defaultMessage: 'Version saved.', description: 'Status'},
    none: {id: 'gui.customized.history.none', defaultMessage: 'No versions yet.', description: 'Empty list'},
    changes: {id: 'gui.customized.history.changes', defaultMessage: 'Changes', description: 'Button'},
    restore: {id: 'gui.customized.history.restore', defaultMessage: 'Open this version', description: 'Button'},
    confirmRestore: {
        id: 'gui.customized.history.confirmRestore',
        defaultMessage: 'Open this version? Changes since the last saved version will be lost.',
        description: 'Confirm'
    },
    confirmSwitch: {
        id: 'gui.customized.history.confirmSwitch',
        defaultMessage: 'Switch branch? Changes since the last saved version will be lost.',
        description: 'Confirm'
    },
    noScriptChanges: {
        id: 'gui.customized.history.noScriptChanges',
        defaultMessage: 'No script changes.',
        description: 'Diff'
    },
    otherChanges: {
        id: 'gui.customized.history.otherChanges',
        defaultMessage: 'Other changes (sprites, variables, costumes order…) too.',
        description: 'Diff'
    },
    assetsAdded: {
        id: 'gui.customized.history.assetsAdded',
        defaultMessage: 'Costumes/sounds added: {list}',
        description: 'Diff'
    },
    assetsRemoved: {
        id: 'gui.customized.history.assetsRemoved',
        defaultMessage: 'Costumes/sounds removed: {list}',
        description: 'Diff'
    },
    push: {id: 'gui.customized.history.push', defaultMessage: 'Push to GitHub/GitLab', description: 'Section'},
    remoteUrl: {id: 'gui.customized.history.remoteUrl', defaultMessage: 'Repository URL (https)', description: 'Label'},
    token: {
        id: 'gui.customized.history.token',
        defaultMessage: 'Access token (not stored)',
        description: 'Label for a personal access token'
    },
    proxy: {id: 'gui.customized.history.proxy', defaultMessage: 'CORS proxy', description: 'Label'},
    pushButton: {id: 'gui.customized.history.pushButton', defaultMessage: 'Push', description: 'Button'},
    pushed: {id: 'gui.customized.history.pushed', defaultMessage: 'Pushed.', description: 'Status'}
});

const DiffView = ({diff}) => {
    const intl = useIntl();
    return (
        <div className={styles.diff}>
            {diff.scripts.length === 0 && <p>{intl.formatMessage(messages.noScriptChanges)}</p>}
            {diff.scripts.map(script => (
                <pre key={script.sprite}>
                    {/* Skip the patch header (separator, ---, +++). */}
                    {script.patch.split('\n').slice(3)
                        .map((line, i) => {
                            let className = null;
                            if (line.startsWith('+')) className = styles.added;
                            else if (line.startsWith('-')) className = styles.removed;
                            else if (line.startsWith('@@')) className = styles.hunk;
                            return (
                                <div
                                    key={i}
                                    className={className}
                                >
                                    {line || ' '}
                                </div>
                            );
                        })}
                </pre>
            ))}
            {diff.assetsAdded.length > 0 &&
                <p>{intl.formatMessage(messages.assetsAdded, {list: diff.assetsAdded.join(', ')})}</p>}
            {diff.assetsRemoved.length > 0 &&
                <p>{intl.formatMessage(messages.assetsRemoved, {list: diff.assetsRemoved.join(', ')})}</p>}
            {diff.otherChanges && <p>{intl.formatMessage(messages.otherChanges)}</p>}
        </div>
    );
};

DiffView.propTypes = {
    diff: PropTypes.shape({
        scripts: PropTypes.arrayOf(PropTypes.shape({sprite: PropTypes.string, patch: PropTypes.string})),
        assetsAdded: PropTypes.arrayOf(PropTypes.string),
        assetsRemoved: PropTypes.arrayOf(PropTypes.string),
        otherChanges: PropTypes.bool
    }).isRequired
};

/**
 * A stable event handler that always calls the latest `handler`.
 * @param {Function} handler - the current handler.
 * @returns {Function} a stable function that forwards to it.
 */
const useCallbackRef = handler => {
    const ref = useRef(handler);
    ref.current = handler;
    return useCallback((...args) => ref.current(...args), []);
};

const HistoryModal = ({projectTitle, projectChanged, vm, onClose, onProjectChanged}) => {
    const intl = useIntl();
    const [repo, setRepo] = useState(null);
    const [branch, setBranch] = useState('main');
    const [branches, setBranches] = useState([]);
    const [versions, setVersions] = useState([]);
    const [message, setMessage] = useState('');
    const [diff, setDiff] = useState(null);
    const [diffOid, setDiffOid] = useState(null);
    const [remote, setRemote] = useState({url: '', token: '', proxy: DEFAULT_CORS_PROXY});
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState(null);
    const [error, setError] = useState(null);

    const refresh = useCallback(async activeRepo => {
        setBranch(await currentBranch(activeRepo));
        setBranches(await listBranches(activeRepo));
        setVersions(await listVersions(activeRepo));
    }, []);

    useEffect(() => {
        openProjectRepo(getBrowserGitFs(), repoDirFor(projectTitle))
            .then(async opened => {
                setRepo(opened);
                await refresh(opened);
            })
            .catch(e => setError(e.message));
    }, [projectTitle, refresh]);

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

    const loadIntoEditor = async sb3 => {
        await reloadProject(vm, sb3);
        onProjectChanged();
    };

    const handleSave = useCallbackRef(() => run(async () => {
        const sb3 = await (await vm.saveProjectSb3()).arrayBuffer();
        const oid = await commitProject(repo, sb3, message.trim() || 'Saved version', AUTHOR);
        setStatus(intl.formatMessage(oid ? messages.saved : messages.nothingChanged));
        setMessage('');
        await refresh(repo);
    }));

    const versionIndex = event => versions.findIndex(version => version.oid === event.currentTarget.dataset.oid);

    const handleChanges = useCallbackRef(event => run(async () => {
        const index = versionIndex(event);
        const version = versions[index];
        if (diffOid === version.oid) {
            setDiff(null);
            setDiffOid(null);
            return;
        }
        // The first version is compared with itself, so it shows no changes.
        const previous = versions[index + 1] ?? version;
        setDiff(await diffVersions(repo, previous.oid, version.oid));
        setDiffOid(version.oid);
    }));

    const handleRestore = useCallbackRef(event => {
        const question = intl.formatMessage(messages.confirmRestore);
        if (projectChanged && !confirm(question)) return; // eslint-disable-line no-alert
        const version = versions[versionIndex(event)];
        run(async () => loadIntoEditor(await readVersion(repo, version.oid)));
    });

    const handleBranchChange = useCallbackRef(event => {
        const name = event.target.value;
        const question = intl.formatMessage(messages.confirmSwitch);
        if (projectChanged && !confirm(question)) return; // eslint-disable-line no-alert
        run(async () => {
            await loadIntoEditor(await switchBranch(repo, name));
            await refresh(repo);
        });
    });

    const handleNewBranch = useCallbackRef(() => {
        const question = intl.formatMessage(messages.newBranchPrompt);
        const name = (prompt(question) ?? '').trim(); // eslint-disable-line no-alert
        if (!name) return;
        run(async () => {
            await createBranch(repo, name);
            await refresh(repo);
        });
    });

    const handlePush = useCallbackRef(() => run(async () => {
        const options = {url: remote.url.trim(), token: remote.token};
        const proxy = remote.proxy.trim();
        await pushToRemote(repo, proxy ? {...options, corsProxy: proxy} : options);
        setStatus(intl.formatMessage(messages.pushed));
    }));

    const handleMessageChange = useCallbackRef(event => setMessage(event.target.value));
    const handleRemoteChange = useCallbackRef(event => {
        const {name, value} = event.target;
        setRemote(current => ({...current, [name]: value}));
    });

    return (
        <Modal
            className={styles.modal}
            contentLabel={`${intl.formatMessage(messages.title)}: ${projectTitle}`}
            onRequestClose={onClose}
            id="historyModal"
        >
            <div className={styles.body}>
                <div className={styles.row}>
                    <label>
                        {intl.formatMessage(messages.branch)}{' '}
                        <select
                            disabled={busy || !repo}
                            value={branch}
                            onChange={handleBranchChange}
                        >
                            {(branches.length ? branches : [branch]).map(name => (
                                <option
                                    key={name}
                                    value={name}
                                >
                                    {name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <button
                        disabled={busy || !repo || versions.length === 0}
                        onClick={handleNewBranch}
                    >
                        {intl.formatMessage(messages.newBranch)}
                    </button>
                </div>
                <div className={styles.row}>
                    <input
                        className={styles.message}
                        placeholder={intl.formatMessage(messages.message)}
                        value={message}
                        onChange={handleMessageChange}
                    />
                    <button
                        className={styles.primary}
                        disabled={busy || !repo}
                        onClick={handleSave}
                    >
                        {intl.formatMessage(messages.save)}
                    </button>
                </div>
                {status && <p className={styles.status}>{status}</p>}
                {error && <p className={styles.error}>{error}</p>}
                {versions.length === 0 && <p className={styles.hint}>{intl.formatMessage(messages.none)}</p>}
                <ul className={styles.versions}>
                    {versions.map(version => (
                        <li key={version.oid}>
                            <div className={styles.version}>
                                <span className={styles.versionMessage}>{version.message}</span>
                                <span className={styles.hint}>
                                    {new Date(version.time).toLocaleString()} · {version.oid.slice(0, 7)}
                                </span>
                                <button
                                    data-oid={version.oid}
                                    disabled={busy}
                                    onClick={handleChanges}
                                >
                                    {intl.formatMessage(messages.changes)}
                                </button>
                                <button
                                    data-oid={version.oid}
                                    disabled={busy}
                                    onClick={handleRestore}
                                >
                                    {intl.formatMessage(messages.restore)}
                                </button>
                            </div>
                            {diffOid === version.oid && diff && <DiffView diff={diff} />}
                        </li>
                    ))}
                </ul>
                <details className={styles.push}>
                    <summary>{intl.formatMessage(messages.push)}</summary>
                    <label>
                        {intl.formatMessage(messages.remoteUrl)}
                        <input
                            name="url"
                            value={remote.url}
                            placeholder="https://github.com/you/your-project.git"
                            onChange={handleRemoteChange}
                        />
                    </label>
                    <label>
                        {intl.formatMessage(messages.token)}
                        <input
                            name="token"
                            type="password"
                            autoComplete="off"
                            value={remote.token}
                            onChange={handleRemoteChange}
                        />
                    </label>
                    <label>
                        {intl.formatMessage(messages.proxy)}
                        <input
                            name="proxy"
                            value={remote.proxy}
                            onChange={handleRemoteChange}
                        />
                    </label>
                    <button
                        disabled={busy || !repo || !remote.url || !remote.token || versions.length === 0}
                        onClick={handlePush}
                    >
                        {intl.formatMessage(messages.pushButton)}
                    </button>
                </details>
            </div>
        </Modal>
    );
};

HistoryModal.propTypes = {
    projectTitle: PropTypes.string.isRequired,
    projectChanged: PropTypes.bool,
    vm: PropTypes.shape({saveProjectSb3: PropTypes.func}).isRequired,
    onClose: PropTypes.func.isRequired,
    onProjectChanged: PropTypes.func.isRequired
};

/* eslint-disable react/prop-types -- props of the connected wrapper, passed straight through. */
const HistoryModalWrapper = ({open, ...props}) => (open ? <HistoryModal {...props} /> : null);
/* eslint-enable react/prop-types */

const mapStateToProps = state => ({
    open: state.scratchGui.projectStorage.dialog === 'history',
    projectTitle: state.scratchGui.projectTitle || 'Project',
    projectChanged: state.scratchGui.projectChanged,
    vm: state.scratchGui.vm
});

const mapDispatchToProps = dispatch => ({
    onClose: () => dispatch(closeProjectStorage()),
    onProjectChanged: () => dispatch(setProjectChanged())
});

export default connect(mapStateToProps, mapDispatchToProps)(HistoryModalWrapper);
