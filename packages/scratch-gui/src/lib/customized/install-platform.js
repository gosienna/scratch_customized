// CUSTOM: connect the platform's editor-only blocks to a scratch-vm instance.
import {createProjectTransforms, installPrimitives} from '@scratch-customized/platform';
import {getEditorMode, usesCustomBlocks} from './editor-mode';

/**
 * Register the editor-only block implementations, and lower them to stock blocks on every save. Loaded
 * projects are raised back to editor-only blocks only while the editor shows Custom (or Text) mode.
 * @param {VirtualMachine} vm - the VM to set up.
 */
const installPlatform = vm => {
    installPrimitives(vm);
    vm.setProjectTransforms(createProjectTransforms({
        shouldRaise: () => usesCustomBlocks(getEditorMode())
    }));
};

export {installPlatform};
