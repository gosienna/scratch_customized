// CUSTOM: how the AI helper moves the learner's view: selecting a sprite and scrolling the code area to a block or
// a point. Nothing here changes the project.
import {EDITOR_MODES} from './editor-mode';
import {findOriginal} from './ai-project-editor';
import {getMainWorkspace} from './main-workspace';

const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

/** Two frames: one for React to show the Code tab, one for the workspace to load and draw its blocks. */
const settle = async () => {
    await nextFrame();
    await nextFrame();
};

const selectTarget = (vm, sprite) => {
    const target = findOriginal(vm, sprite);
    if (!target) throw new Error(`There is no sprite named "${sprite}"`);
    vm.setEditingTarget(target.id);
};

/**
 * @param {VirtualMachine} vm - the VM.
 * @param {{activateBlocksTab: Function, editorMode: Function}} gui - shows the Code tab; reads the editor mode.
 * @returns {object} an EditorView for the platform's assistant.
 */
const createEditorView = (vm, {activateBlocksTab, editorMode}) => ({
    openSprite (sprite) {
        selectTarget(vm, sprite);
        return Promise.resolve();
    },

    async showInWorkspace (sprite, place) {
        if (editorMode() === EDITOR_MODES.TEXT) {
            selectTarget(vm, sprite);
            return {shown: false, reason: 'The learner is in Text mode, where the blocks are hidden'};
        }
        // The Code tab first: showing it reloads the workspace, which would undo a scroll made before.
        activateBlocksTab();
        await settle();
        selectTarget(vm, sprite);
        await settle();
        const workspace = getMainWorkspace();
        if (!workspace) throw new Error('showInWorkspace: the code area is not open');
        if (place.blockId) {
            if (!workspace.getBlockById(place.blockId)) {
                throw new Error(`showInWorkspace: block "${place.blockId}" is not on the code area of "${sprite}"`);
            }
            workspace.centerOnBlock(place.blockId, true);
        } else {
            const metrics = workspace.getMetrics();
            workspace.scroll(
                -((place.x * workspace.scale) - (metrics.viewWidth / 2)),
                -((place.y * workspace.scale) - (metrics.viewHeight / 2))
            );
        }
        return {shown: true};
    }
});

export {createEditorView};
