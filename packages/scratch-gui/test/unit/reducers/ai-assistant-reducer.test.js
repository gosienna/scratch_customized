/* eslint-env jest */
import aiAssistantReducer, {
    aiAssistantInitialState,
    setAiAssistantCanEdit,
    setAiAssistantVisible
} from '../../../src/reducers/ai-assistant';

describe('aiAssistant reducer', () => {
    beforeEach(() => window.localStorage.clear());

    test('starts closed, with editing off', () => {
        expect(aiAssistantReducer(undefined, {type: 'anything'})).toEqual({visible: false, canEdit: false});
    });

    test('turning editing on is remembered for the next visit', () => {
        const on = aiAssistantReducer(undefined, setAiAssistantCanEdit(true));
        expect(on.canEdit).toBe(true);
        expect(aiAssistantInitialState().canEdit).toBe(true);
        aiAssistantReducer(on, setAiAssistantCanEdit(false));
        expect(aiAssistantInitialState().canEdit).toBe(false);
    });

    test('opening and closing is remembered for the next visit', () => {
        const opened = aiAssistantReducer(undefined, setAiAssistantVisible(true));
        expect(opened.visible).toBe(true);
        expect(aiAssistantInitialState().visible).toBe(true);
        aiAssistantReducer(opened, setAiAssistantVisible(false));
        expect(aiAssistantInitialState().visible).toBe(false);
    });
});
