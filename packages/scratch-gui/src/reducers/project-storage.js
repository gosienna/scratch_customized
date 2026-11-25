// CUSTOM: the project storage dialog, and where the current project was last opened from or saved to.
const OPEN_DIALOG = 'scratch-gui/project-storage/OPEN_DIALOG';
const CLOSE_DIALOG = 'scratch-gui/project-storage/CLOSE_DIALOG';
const SET_CURRENT = 'scratch-gui/project-storage/SET_CURRENT';

const initialState = {
    /** null when closed, otherwise 'open' or 'save'. */
    dialog: null,
    /** {kind, id, name} of the stored copy of the current project, or null. */
    current: null
};

const reducer = function (state, action) {
    if (typeof state === 'undefined') state = initialState;
    switch (action.type) {
    case OPEN_DIALOG:
        return {...state, dialog: action.purpose};
    case CLOSE_DIALOG:
        return {...state, dialog: null};
    case SET_CURRENT:
        return {...state, current: action.current};
    default:
        return state;
    }
};

/**
 * @param {'open'|'save'} purpose - whether the dialog opens or saves a project.
 * @returns {object} the action.
 */
const openProjectStorage = purpose => ({type: OPEN_DIALOG, purpose});
const closeProjectStorage = () => ({type: CLOSE_DIALOG});
/**
 * @param {?{kind: string, id: string, name: string}} current - the stored copy of the current project.
 * @returns {object} the action.
 */
const setStoredProject = current => ({type: SET_CURRENT, current});

export {
    reducer as default,
    initialState as projectStorageInitialState,
    openProjectStorage,
    closeProjectStorage,
    setStoredProject
};
