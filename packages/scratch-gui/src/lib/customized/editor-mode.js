// CUSTOM: the editor mode (Original Scratch, Custom, or Text), shared by the Redux store and the VM transforms.
const STORAGE_KEY = 'scratchCustomized.editorMode';

const EDITOR_MODES = {
    ORIGINAL: 'original',
    CUSTOM: 'custom',
    TEXT: 'text'
};

const DEFAULT_EDITOR_MODE = EDITOR_MODES.CUSTOM;

const isEditorMode = mode => Object.values(EDITOR_MODES).includes(mode);

const readStoredMode = () => {
    try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (isEditorMode(stored)) return stored;
    } catch (e) {
        // localStorage can be unavailable (e.g. privacy settings); fall back to the default.
    }
    return DEFAULT_EDITOR_MODE;
};

let currentMode = typeof window === 'undefined' ? DEFAULT_EDITOR_MODE : readStoredMode();

/** @returns {string} the current editor mode. */
const getEditorMode = () => currentMode;

/**
 * Remember the editor mode for this session and future visits.
 * @param {string} mode - one of EDITOR_MODES.
 */
const storeEditorMode = mode => {
    if (!isEditorMode(mode)) throw new Error(`storeEditorMode: unknown editor mode "${mode}"`);
    currentMode = mode;
    try {
        window.localStorage.setItem(STORAGE_KEY, mode);
    } catch (e) {
        // Not persisted; the mode still applies for this session.
    }
};

/**
 * Text mode shows the same blocks as Custom mode in another form, so both use Custom-mode blocks.
 * @param {string} mode - one of EDITOR_MODES.
 * @returns {boolean} whether the mode uses the custom block set.
 */
const usesCustomBlocks = mode => mode !== EDITOR_MODES.ORIGINAL;

export {
    DEFAULT_EDITOR_MODE,
    EDITOR_MODES,
    getEditorMode,
    isEditorMode,
    storeEditorMode,
    usesCustomBlocks
};
