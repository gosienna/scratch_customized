// CUSTOM: the menu bar's branch chip and Commit button. Committing saves a version to the project's Git repository
// in this browser, then backs the repository up to its folder or Google Drive file, if it has one.
import PropTypes from 'prop-types';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {connect} from 'react-redux';
import {listBranches} from '@scratch-customized/platform';

import VcsBar from '../../components/customized/vcs-bar.jsx';
import {
    createProjectBranch,
    openRepo,
    saveProject,
    switchProjectBranch
} from '../../lib/customized/project-repo';
import log from '../../lib/log';
import {
    closeProjectStorage,
    openProjectStorage,
    setStoredProject,
    setVcsStatus
} from '../../reducers/project-storage';
import {setProjectUnchanged} from '../../reducers/project-changed';

const messages = defineMessages({
    committed: {
        id: 'gui.customized.vcs.committed',
        defaultMessage: 'Committed to {branch}',
        description: 'Status after a commit'
    },
    committedBackedUp: {
        id: 'gui.customized.vcs.committedBackedUp',
        defaultMessage: 'Committed to {branch} · backed up to {place}',
        description: 'Status after a commit that was also uploaded to the project\'s backup'
    },
    nothingToCommit: {
        id: 'gui.customized.vcs.nothingToCommit',
        defaultMessage: 'No changes since the last commit',
        description: 'Status after Commit when nothing changed'
    },
    notBackedUp: {
        id: 'gui.customized.vcs.notBackedUp',
        defaultMessage: 'Committed to {branch}, but not backed up: {error}',
        description: 'Status when the commit worked and the upload to a folder or Drive did not'
    },
    failed: {
        id: 'gui.customized.vcs.failed',
        defaultMessage: 'Could not commit: {error}',
        description: 'Status when a commit failed'
    },
    drive: {id: 'gui.customized.vcs.drivePlace', defaultMessage: 'Google Drive', description: 'Backup place'},
    folder: {id: 'gui.customized.vcs.folderPlace', defaultMessage: 'the folder', description: 'Backup place'},
    newBranchPrompt: {
        id: 'gui.customized.vcs.newBranchPrompt',
        defaultMessage: 'Name of the new branch (it starts from the latest commit; your next commit goes to it):',
        description: 'Prompt for a new branch name'
    },
    confirmSwitch: {
        id: 'gui.customized.vcs.confirmSwitch',
        defaultMessage: 'Switch to "{branch}"? Changes since the last commit will be lost.',
        description: 'Confirm switching branch with uncommitted changes'
    }
});

const VcsBarContainer = ({
    branch,
    committing,
    current,
    projectChanged,
    projectTitle,
    status,
    vm,
    onCloseCommit,
    onOpenCommit,
    onOpenHistory,
    onStatus,
    onStored
}) => {
    const intl = useIntl();
    const [menuOpen, setMenuOpen] = useState(false);
    const [branches, setBranches] = useState([]);
    const [commitMessage, setCommitMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const rootRef = useRef(null);

    const canCommit = !current || projectChanged;

    // Success messages fade after a while; errors stay until the next action.
    useEffect(() => {
        if (!status || status.error) return;
        const timeout = setTimeout(() => onStatus(null), 6000);
        return () => clearTimeout(timeout);
    }, [status, onStatus]);

    // Ctrl/Cmd+S commits, as Save does in other editors.
    useEffect(() => {
        const handleKeyDown = event => {
            if (event.key.toLowerCase() !== 's' || !(event.ctrlKey || event.metaKey) || event.altKey) return;
            event.preventDefault();
            if (!busy) onOpenCommit();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [busy, onOpenCommit]);

    // A click elsewhere closes the branch menu and the commit popover.
    useEffect(() => {
        if (!menuOpen && !committing) return;
        const handleMouseDown = event => {
            if (rootRef.current?.contains(event.target)) return;
            setMenuOpen(false);
            if (committing) onCloseCommit();
        };
        document.addEventListener('mousedown', handleMouseDown);
        return () => document.removeEventListener('mousedown', handleMouseDown);
    }, [menuOpen, committing, onCloseCommit]);

    const run = async action => {
        setBusy(true);
        try {
            await action();
        } catch (e) {
            log.warn('VcsBar: action failed', e);
            onStatus({message: intl.formatMessage(messages.failed, {error: e.message}), error: true});
        } finally {
            setBusy(false);
        }
    };

    const handleBranchClick = useCallback(() => {
        if (menuOpen) {
            setMenuOpen(false);
            return;
        }
        onCloseCommit();
        setMenuOpen(true);
        if (!current) {
            setBranches(['main']);
            return;
        }
        openRepo(current.repoId)
            .then(listBranches)
            .then(setBranches, e => log.warn(`VcsBar: could not list the branches of ${current.repoId}`, e));
    }, [menuOpen, current, onCloseCommit]);

    const handleSwitchBranch = useCallback(event => {
        const name = event.currentTarget.dataset.branch;
        setMenuOpen(false);
        if (!current || name === branch) return;
        const question = intl.formatMessage(messages.confirmSwitch, {branch: name});
        if (projectChanged && !confirm(question)) return; // eslint-disable-line no-alert
        run(async () => {
            await switchProjectBranch(vm, current.repoId, name);
            onStored(current, name, true);
        });
    }, [current, branch, projectChanged, vm, onStored]);

    const handleNewBranchClick = useCallback(() => {
        setMenuOpen(false);
        const question = intl.formatMessage(messages.newBranchPrompt);
        const name = (prompt(question) ?? '').trim(); // eslint-disable-line no-alert
        if (!name || !current) return;
        run(async () => {
            await createProjectBranch(current.repoId, name);
            onStored(current, name, false);
        });
    }, [current, onStored]);

    const handleHistoryClick = useCallback(() => {
        setMenuOpen(false);
        onOpenHistory();
    }, [onOpenHistory]);

    const handleCommitClick = useCallback(() => {
        setMenuOpen(false);
        if (committing) onCloseCommit();
        else onOpenCommit();
    }, [committing, onCloseCommit, onOpenCommit]);

    const handleCommitMessageChange = useCallback(event => setCommitMessage(event.target.value), []);

    const handleCommitSubmit = useCallback(event => {
        event.preventDefault();
        run(async () => {
            const result = await saveProject({vm, current, name: projectTitle, message: commitMessage});
            onStored(result.current, result.branch, true);
            onCloseCommit();
            setCommitMessage('');
            const values = {branch: result.branch};
            if (result.backupError) {
                onStatus({
                    message: intl.formatMessage(messages.notBackedUp, {...values, error: result.backupError.message}),
                    error: true
                });
            } else if (!result.committed) {
                onStatus({message: intl.formatMessage(messages.nothingToCommit), error: false});
            } else if (result.current.backupKind) {
                const place = intl.formatMessage(messages[result.current.backupKind]);
                onStatus({message: intl.formatMessage(messages.committedBackedUp, {...values, place}), error: false});
            } else {
                onStatus({message: intl.formatMessage(messages.committed, values), error: false});
            }
        });
    }, [vm, current, projectTitle, commitMessage, onStored, onCloseCommit, onStatus]);

    return (
        <div ref={rootRef}>
            <VcsBar
                branch={branch}
                branches={branches}
                busy={busy}
                canCommit={canCommit}
                commitMessage={commitMessage}
                committing={committing}
                hasChanges={projectChanged}
                menuOpen={menuOpen}
                saved={Boolean(current)}
                status={status}
                onBranchClick={handleBranchClick}
                onCancelCommit={onCloseCommit}
                onCommitClick={handleCommitClick}
                onCommitMessageChange={handleCommitMessageChange}
                onCommitSubmit={handleCommitSubmit}
                onHistoryClick={handleHistoryClick}
                onNewBranchClick={handleNewBranchClick}
                onSwitchBranch={handleSwitchBranch}
            />
        </div>
    );
};

VcsBarContainer.propTypes = {
    branch: PropTypes.string,
    committing: PropTypes.bool,
    current: PropTypes.shape({repoId: PropTypes.string, backupKind: PropTypes.string}),
    projectChanged: PropTypes.bool,
    projectTitle: PropTypes.string.isRequired,
    status: PropTypes.shape({message: PropTypes.string, error: PropTypes.bool}),
    vm: PropTypes.shape({saveProjectSb3: PropTypes.func}).isRequired,
    onCloseCommit: PropTypes.func.isRequired,
    onOpenCommit: PropTypes.func.isRequired,
    onOpenHistory: PropTypes.func.isRequired,
    onStatus: PropTypes.func.isRequired,
    onStored: PropTypes.func.isRequired
};

const mapStateToProps = state => ({
    branch: state.scratchGui.projectStorage.branch,
    committing: state.scratchGui.projectStorage.dialog === 'commit',
    current: state.scratchGui.projectStorage.current,
    projectChanged: state.scratchGui.projectChanged,
    projectTitle: state.scratchGui.projectTitle || 'Project',
    status: state.scratchGui.projectStorage.vcsStatus,
    vm: state.scratchGui.vm
});

const mapDispatchToProps = dispatch => ({
    onCloseCommit: () => dispatch(closeProjectStorage()),
    onOpenCommit: () => dispatch(openProjectStorage('commit')),
    onOpenHistory: () => dispatch(openProjectStorage('history')),
    onStatus: status => dispatch(setVcsStatus(status)),
    /**
     * @param {object} current - the project's repository.
     * @param {string} branch - its current branch.
     * @param {boolean} loaded - the editor now matches that branch's latest commit.
     */
    onStored: (current, branch, loaded) => {
        dispatch(setStoredProject(current, branch));
        if (loaded) dispatch(setProjectUnchanged());
    }
});

export default connect(mapStateToProps, mapDispatchToProps)(VcsBarContainer);
