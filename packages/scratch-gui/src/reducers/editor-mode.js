// CUSTOM: which editor is shown (Original Scratch, Custom, or Text).
import {getEditorMode, storeEditorMode} from '../lib/customized/editor-mode';

const SET_EDITOR_MODE = 'scratch-gui/editor-mode/SET_EDITOR_MODE';

const reducer = function (state, action) {
    if (typeof state === 'undefined') state = getEditorMode();
    switch (action.type) {
    case SET_EDITOR_MODE:
        return action.mode;
    default:
        return state;
    }
};

/**
 * @param {string} mode - one of EDITOR_MODES.
 * @returns {object} the action. The mode is also remembered for future visits.
 */
const setEditorMode = function (mode) {
    storeEditorMode(mode);
    return {
        type: SET_EDITOR_MODE,
        mode
    };
};

export {
    reducer as default,
    getEditorMode as editorModeInitialState,
    setEditorMode
};
