import {STAGE_DISPLAY_SIZES} from '../lib/layout-constants.js';
import {readStoredStageWidth} from '../lib/customized/stage-width.js'; // CUSTOM

const SET_STAGE_SIZE = 'scratch-gui/StageSize/SET_STAGE_SIZE';
const SET_STAGE_WIDTH = 'scratch-gui/StageSize/SET_STAGE_WIDTH'; // CUSTOM

const initialState = {
    stageSize: STAGE_DISPLAY_SIZES.large,
    // CUSTOM: the stage width in pixels chosen by dragging the stage's edge (used in Custom mode only)
    stageWidth: readStoredStageWidth()
};

const reducer = function (state, action) {
    if (typeof state === 'undefined') state = initialState;
    switch (action.type) {
    case SET_STAGE_SIZE:
        return {
            ...state,
            stageSize: action.stageSize
        };
    // CUSTOM
    case SET_STAGE_WIDTH:
        return {
            ...state,
            stageWidth: action.stageWidth
        };
    default:
        return state;
    }
};

const setStageSize = function (stageSize) {
    return {
        type: SET_STAGE_SIZE,
        stageSize: stageSize
    };
};

// CUSTOM
const setStageWidth = function (stageWidth) {
    return {
        type: SET_STAGE_WIDTH,
        stageWidth
    };
};

export {
    reducer as default,
    initialState as stageSizeInitialState,
    setStageSize,
    setStageWidth
};
