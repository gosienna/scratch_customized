/* eslint-env jest */
import reducer, {
    closeProjectStorage,
    openProjectStorage,
    projectStorageInitialState,
    setLastStoreKind,
    setStoredProject,
    setVcsStatus
} from '../../../src/reducers/project-storage';

test('opens and closes the My Projects page', () => {
    const open = reducer(projectStorageInitialState, openProjectStorage('projects'));
    expect(open.dialog).toBe('projects');
    expect(reducer(open, closeProjectStorage()).dialog).toBeNull();
});

test('remembers the last store shown, also in localStorage', () => {
    const state = reducer(projectStorageInitialState, setLastStoreKind('drive'));
    expect(state.lastKind).toBe('drive');
    expect(window.localStorage.getItem('scratchCustomized.projectStorage.lastKind')).toBe('drive');
});

test('keeps the current repository and its branch, and forgets them for a different project', () => {
    const current = {repoId: 'r1', name: 'Game', backupKind: 'drive', backupId: 'f1'};
    let state = reducer(projectStorageInitialState, setVcsStatus({message: 'old', error: false}));
    state = reducer(state, setStoredProject(current, 'main'));
    expect(state).toMatchObject({current, branch: 'main', vcsStatus: null});

    state = reducer(state, setVcsStatus({message: 'Committed to main', error: false}));
    expect(state.vcsStatus).toEqual({message: 'Committed to main', error: false});

    // File > New and File > Load from your computer put a project in the editor that has no repository yet.
    for (const type of [
        'scratch-gui/project-state/START_FETCHING_NEW',
        'scratch-gui/project-state/START_LOADING_VM_FILE_UPLOAD'
    ]) {
        expect(reducer(state, {type})).toMatchObject({current: null, branch: null, vcsStatus: null});
    }
});
