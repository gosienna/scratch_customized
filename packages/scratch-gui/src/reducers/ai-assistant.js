// CUSTOM: the AI assistant panel: whether it is open, and whether the assistant may change the project (a setting,
// off by default). Both are remembered for future visits.
const VISIBLE_KEY = 'scratchCustomized.aiAssistantVisible';
const CAN_EDIT_KEY = 'scratchCustomized.aiAssistantCanEdit';

const SET_VISIBLE = 'scratch-gui/ai-assistant/SET_VISIBLE';
const SET_CAN_EDIT = 'scratch-gui/ai-assistant/SET_CAN_EDIT';

const readFlag = key => {
    try {
        return window.localStorage.getItem(key) === 'true';
    } catch (e) {
        return false;
    }
};

const storeFlag = (key, value) => {
    try {
        window.localStorage.setItem(key, String(value));
    } catch (e) {
        // Private browsing can refuse storage; the choice still applies for this visit.
    }
};

const aiAssistantInitialState = () => ({
    visible: readFlag(VISIBLE_KEY),
    canEdit: readFlag(CAN_EDIT_KEY)
});

const reducer = function (state, action) {
    if (typeof state === 'undefined') state = aiAssistantInitialState();
    switch (action.type) {
    case SET_VISIBLE:
        storeFlag(VISIBLE_KEY, action.visible);
        return {...state, visible: action.visible};
    case SET_CAN_EDIT:
        storeFlag(CAN_EDIT_KEY, action.canEdit);
        return {...state, canEdit: action.canEdit};
    default:
        return state;
    }
};

/**
 * @param {boolean} visible - whether the panel should be open.
 * @returns {object} the action.
 */
const setAiAssistantVisible = visible => ({
    type: SET_VISIBLE,
    visible
});

/**
 * @param {boolean} canEdit - whether the assistant may create sprites and costumes and change code.
 * @returns {object} the action.
 */
const setAiAssistantCanEdit = canEdit => ({
    type: SET_CAN_EDIT,
    canEdit
});

export {
    reducer as default,
    aiAssistantInitialState,
    setAiAssistantCanEdit,
    setAiAssistantVisible
};
