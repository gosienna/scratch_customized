// CUSTOM: the stage width that Custom mode lets the user choose by dragging the stage's edge.
import layout from '../layout-constants';

const STORAGE_KEY = 'scratchCustomized.stageWidth';

const MIN_STAGE_WIDTH = 240;
const MAX_STAGE_WIDTH = 960;

/**
 * @param {number} width - a requested stage width in pixels.
 * @returns {number} the width rounded and clamped to the allowed range.
 */
const clampStageWidth = width => Math.round(Math.min(MAX_STAGE_WIDTH, Math.max(MIN_STAGE_WIDTH, width)));

/** @returns {number} the remembered stage width, or the standard width if none is stored. */
const readStoredStageWidth = () => {
    try {
        const stored = Number(window.localStorage.getItem(STORAGE_KEY));
        if (stored) return clampStageWidth(stored);
    } catch (e) {
        // localStorage can be unavailable (e.g. privacy settings); fall back to the default.
    }
    return layout.standardStageWidth;
};

/** @param {number} width - the stage width to remember for future visits. */
const storeStageWidth = width => {
    try {
        window.localStorage.setItem(STORAGE_KEY, String(width));
    } catch (e) {
        // Not persisted; the width still applies for this session.
    }
};

export {
    MAX_STAGE_WIDTH,
    MIN_STAGE_WIDTH,
    clampStageWidth,
    readStoredStageWidth,
    storeStageWidth
};
