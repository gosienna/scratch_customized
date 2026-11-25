// CUSTOM: switching between Original, Custom and Text editor modes.
import {defineMessages} from 'react-intl';
import {setEditorMode} from '../../reducers/editor-mode';
import {EDITOR_MODES} from './editor-mode';

const editorModeMessages = defineMessages({
    [EDITOR_MODES.ORIGINAL]: {
        id: 'gui.customized.editorMode.original',
        defaultMessage: 'Original Scratch',
        description: 'Editor mode that shows the unmodified Scratch editor'
    },
    [EDITOR_MODES.CUSTOM]: {
        id: 'gui.customized.editorMode.custom',
        defaultMessage: 'Custom',
        description: 'Editor mode with typed expressions, scoped variables and other additions'
    },
    [EDITOR_MODES.TEXT]: {
        id: 'gui.customized.editorMode.text',
        defaultMessage: 'Text (Python / JavaScript)',
        description: 'Editor mode where code is written as text'
    }
});

/**
 * The editor modes offered in the menu, as a PreferenceMenu items map.
 * @param {string[]} modes - the modes to offer, in order.
 * @returns {object} map from mode to {label}.
 */
const editorModeItems = modes => Object.fromEntries(modes.map(mode => [mode, {label: editorModeMessages[mode]}]));

/**
 * Switch the editor mode. The project is saved (which turns editor-only blocks into stock blocks) and loaded
 * again under the new mode (which turns them back only in Custom and Text modes), so every mode sees the
 * project exactly as it would be saved.
 * @param {VirtualMachine} vm - the VM.
 * @param {string} mode - the new mode.
 * @param {Function} dispatch - the Redux dispatch function.
 * @returns {Promise} resolves when the project has been reloaded.
 */
const switchEditorMode = async (vm, mode, dispatch) => {
    const editingTargetName = vm.editingTarget?.getName();
    const sb3 = await vm.saveProjectSb3();
    dispatch(setEditorMode(mode));
    await vm.loadProject(await sb3.arrayBuffer());
    const target = vm.runtime.targets.find(t => t.isOriginal && t.getName() === editingTargetName);
    if (target) vm.setEditingTarget(target.id);
};

export {
    editorModeItems,
    switchEditorMode
};
