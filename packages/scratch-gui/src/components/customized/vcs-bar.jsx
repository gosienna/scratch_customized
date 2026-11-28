// CUSTOM: the current branch and the Commit button, in the menu bar beside the project title.
import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, useIntl} from 'react-intl';

import styles from './vcs-bar.css';

const messages = defineMessages({
    branchTitle: {
        id: 'gui.customized.vcs.branchTitle',
        defaultMessage: 'Branch: your next commit goes to "{branch}". Click to switch or start a branch.',
        description: 'Tooltip of the current-branch chip in the menu bar'
    },
    notSavedTitle: {
        id: 'gui.customized.vcs.notSavedTitle',
        defaultMessage: 'Not saved yet. The first commit starts this project\'s history on "main".',
        description: 'Tooltip of the branch chip before the project has any commit'
    },
    newBranch: {id: 'gui.customized.vcs.newBranch', defaultMessage: 'New branch…', description: 'Branch menu item'},
    history: {id: 'gui.customized.vcs.history', defaultMessage: 'History…', description: 'Branch menu item'},
    commit: {id: 'gui.customized.vcs.commit', defaultMessage: 'Commit', description: 'Menu bar button'},
    commitTitle: {
        id: 'gui.customized.vcs.commitTitle',
        defaultMessage: 'Save a version of the project (Ctrl+S)',
        description: 'Tooltip of the Commit button'
    },
    noChanges: {
        id: 'gui.customized.vcs.noChanges',
        defaultMessage: 'No changes since the last commit',
        description: 'Tooltip of the Commit button when there is nothing to commit'
    },
    messageLabel: {
        id: 'gui.customized.vcs.messageLabel',
        defaultMessage: 'What did you change?',
        description: 'Label and placeholder of the commit message field'
    },
    commitTo: {
        id: 'gui.customized.vcs.commitTo',
        defaultMessage: 'Commit to {branch}',
        description: 'Button in the commit popover'
    },
    cancel: {id: 'gui.customized.vcs.cancel', defaultMessage: 'Cancel', description: 'Button'}
});

const VcsBar = ({
    branch,
    branches,
    busy,
    canCommit,
    commitMessage,
    committing,
    hasChanges,
    menuOpen,
    saved,
    status,
    onBranchClick,
    onCancelCommit,
    onCommitClick,
    onCommitMessageChange,
    onCommitSubmit,
    onHistoryClick,
    onNewBranchClick,
    onSwitchBranch
}) => {
    const intl = useIntl();
    const branchName = branch ?? 'main';
    const chipTitle = intl.formatMessage(saved ? messages.branchTitle : messages.notSavedTitle, {branch: branchName});
    return (
        <div className={styles.bar}>
            <div className={styles.anchor}>
                <button
                    className={saved ? styles.chip : styles.chipUnsaved}
                    title={chipTitle}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    disabled={busy}
                    onClick={onBranchClick}
                >
                    <span aria-hidden="true">{'⎇'}</span>
                    {branchName}
                    <span aria-hidden="true">{'▾'}</span>
                </button>
                {menuOpen && (
                    <ul
                        className={styles.menu}
                        role="menu"
                    >
                        {branches.map(name => (
                            <li key={name}>
                                <button
                                    role="menuitemradio"
                                    aria-checked={name === branchName}
                                    className={styles.menuItem}
                                    data-branch={name}
                                    onClick={onSwitchBranch}
                                >
                                    <span className={styles.check}>{name === branchName ? '✓' : ''}</span>
                                    {name}
                                </button>
                            </li>
                        ))}
                        <li className={styles.separator}>
                            <button
                                role="menuitem"
                                className={styles.menuItem}
                                disabled={!saved}
                                onClick={onNewBranchClick}
                            >
                                <span className={styles.check} />
                                {intl.formatMessage(messages.newBranch)}
                            </button>
                        </li>
                        <li>
                            <button
                                role="menuitem"
                                className={styles.menuItem}
                                onClick={onHistoryClick}
                            >
                                <span className={styles.check} />
                                {intl.formatMessage(messages.history)}
                            </button>
                        </li>
                    </ul>
                )}
            </div>
            <div className={styles.anchor}>
                <button
                    className={styles.commit}
                    title={intl.formatMessage(canCommit ? messages.commitTitle : messages.noChanges)}
                    disabled={busy || !canCommit}
                    onClick={onCommitClick}
                >
                    {hasChanges && (
                        <span
                            className={styles.dot}
                            aria-hidden="true"
                        >
                            {'●'}
                        </span>
                    )}
                    {intl.formatMessage(messages.commit)}
                </button>
                {committing && (
                    <form
                        className={styles.popover}
                        onSubmit={onCommitSubmit}
                    >
                        <input
                            autoFocus
                            aria-label={intl.formatMessage(messages.messageLabel)}
                            placeholder={intl.formatMessage(messages.messageLabel)}
                            value={commitMessage}
                            onChange={onCommitMessageChange}
                        />
                        <div className={styles.popoverButtons}>
                            <button
                                type="button"
                                className={styles.secondary}
                                onClick={onCancelCommit}
                            >
                                {intl.formatMessage(messages.cancel)}
                            </button>
                            <button
                                type="submit"
                                className={styles.primary}
                                disabled={busy}
                            >
                                {intl.formatMessage(messages.commitTo, {branch: branchName})}
                            </button>
                        </div>
                    </form>
                )}
            </div>
            {status && (
                <span
                    className={status.error ? styles.statusError : styles.status}
                    role="status"
                    title={status.message}
                >
                    {status.message}
                </span>
            )}
        </div>
    );
};

VcsBar.propTypes = {
    branch: PropTypes.string,
    branches: PropTypes.arrayOf(PropTypes.string).isRequired,
    busy: PropTypes.bool,
    canCommit: PropTypes.bool,
    commitMessage: PropTypes.string.isRequired,
    committing: PropTypes.bool,
    hasChanges: PropTypes.bool,
    menuOpen: PropTypes.bool,
    saved: PropTypes.bool,
    status: PropTypes.shape({message: PropTypes.string, error: PropTypes.bool}),
    onBranchClick: PropTypes.func.isRequired,
    onCancelCommit: PropTypes.func.isRequired,
    onCommitClick: PropTypes.func.isRequired,
    onCommitMessageChange: PropTypes.func.isRequired,
    onCommitSubmit: PropTypes.func.isRequired,
    onHistoryClick: PropTypes.func.isRequired,
    onNewBranchClick: PropTypes.func.isRequired,
    onSwitchBranch: PropTypes.func.isRequired
};

export default VcsBar;
