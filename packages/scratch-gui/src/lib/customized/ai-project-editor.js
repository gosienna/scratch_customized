// CUSTOM: how the AI helper changes the project when the learner has turned editing on in Settings. Each change
// goes through the same code paths as the learner's own: Text mode's apply, costume upload and "Paint" sprite.
import {applyText} from '@scratch-customized/platform';

import {emptySprite} from '../empty-assets';
import {costumeUpload} from '../file-uploader';
import {getMainWorkspace} from './main-workspace';
import {reloadWithProjectJson} from './reload-project';

const findOriginal = (vm, name) => vm.runtime.targets.find(t => t.isOriginal && t.getName() === name);

const COMMENT_SIZE = 200;
const COMMENT_GAP = 40;

/**
 * Where a new comment goes when no position is given: right of its block as drawn when the sprite is open,
 * otherwise right of its script's top block, or right of all the scripts for a comment on its own.
 * @param {object} target - the VM target.
 * @param {string|null} blockId - the block the comment is attached to.
 * @returns {{x: number, y: number}} the workspace position.
 */
const commentPosition = (target, blockId) => {
    const workspace = getMainWorkspace();
    const drawn = blockId && target.runtime.getEditingTarget() === target && workspace?.getBlockById(blockId);
    if (drawn) {
        const {x, y} = drawn.getRelativeToSurfaceXY();
        return {x: x + drawn.width + COMMENT_GAP, y};
    }
    const topId = blockId ? target.blocks.getTopLevelScript(blockId) : null;
    const tops = (topId ? [topId] : target.blocks.getScripts()).map(id => target.blocks.getBlock(id));
    if (tops.length === 0) return {x: 0, y: 0};
    return {
        x: Math.max(...tops.map(block => block.x ?? 0)) + (COMMENT_SIZE * 2),
        y: Math.min(...tops.map(block => block.y ?? 0))
    };
};

/**
 * Turn SVG text into a VM costume object, sanitized and stored like an uploaded SVG file.
 * @param {VirtualMachine} vm - the VM whose storage keeps the costume.
 * @param {{name: string, svg: string}} costume - the costume name and SVG document.
 * @returns {Promise<object>} the costume object for vm.addCostume / vm.addBackdrop.
 */
const svgCostume = (vm, {name, svg}) => new Promise((resolve, reject) => {
    if (!/<svg[\s>]/i.test(svg)) {
        reject(new Error('The costume must be an SVG document (<svg ...>...</svg>)'));
        return;
    }
    costumeUpload(new TextEncoder().encode(svg), 'image/svg+xml', vm.runtime.storage, ([costume]) => {
        costume.name = name;
        resolve(costume);
    }, error => reject(new Error(`The SVG could not be used: ${error}`)));
});

/**
 * @param {VirtualMachine} vm - the VM.
 * @param {Function} onProjectChanged - marks the project as changed (needed after a reload).
 * @returns {object} a ProjectEditor for the platform's assistant.
 */
const createProjectEditor = (vm, onProjectChanged) => ({
    async setSpriteCode (sprite, code) {
        const project = applyText(JSON.parse(vm.toJSON()), sprite, code, 'python');
        await reloadWithProjectJson(vm, project);
        onProjectChanged();
    },

    async createSprite (name, costume) {
        const vmCostume = await svgCostume(vm, costume);
        // The "Paint" path: an empty sprite, then its real costume replaces the blank one.
        await vm.addSprite(JSON.stringify(emptySprite(name, 'pop', 'blank')));
        const target = findOriginal(vm, name);
        if (!target) throw new Error(`createSprite: the new sprite "${name}" was not found after adding it`);
        vm.setEditingTarget(target.id);
        await vm.addCostume(vmCostume.md5, vmCostume, target.id);
        vm.deleteCostume(0);
    },

    async addCostume (sprite, costume) {
        const target = findOriginal(vm, sprite);
        if (!target) throw new Error(`There is no sprite named "${sprite}"`);
        const vmCostume = await svgCostume(vm, costume);
        if (target.isStage) await vm.addBackdrop(vmCostume.md5, vmCostume);
        else await vm.addCostume(vmCostume.md5, vmCostume, target.id);
    },

    addComment (sprite, {text, blockId, x, y}) {
        const target = findOriginal(vm, sprite);
        if (!target) throw new Error(`There is no sprite named "${sprite}"`);
        const auto = commentPosition(target, blockId);
        const id = crypto.randomUUID();
        target.createComment(id, blockId, text, x ?? auto.x, y ?? auto.y, COMMENT_SIZE, COMMENT_SIZE, false);
        if (vm.editingTarget === target) vm.emitWorkspaceUpdate();
        onProjectChanged();
        return Promise.resolve(id);
    }
});

export {createProjectEditor, findOriginal};
