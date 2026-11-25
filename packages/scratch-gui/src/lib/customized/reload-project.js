// CUSTOM: reload the project in the VM, keeping the sprite being edited selected.
import JSZip from 'jszip';

/**
 * Load project data into the VM and select the target that was being edited before (matched by name).
 * @param {VirtualMachine} vm - the VM.
 * @param {ArrayBuffer} data - an .sb3 file.
 * @returns {Promise} resolves when the project is loaded.
 */
const reloadProject = async (vm, data) => {
    const editingTargetName = vm.editingTarget?.getName();
    await vm.loadProject(data);
    const target = vm.runtime.targets.find(t => t.isOriginal && t.getName() === editingTargetName);
    if (target) vm.setEditingTarget(target.id);
};

/**
 * Replace the project's project.json (keeping its costumes and sounds) and reload it.
 * @param {VirtualMachine} vm - the VM.
 * @param {object} projectJson - the new project.json content.
 * @returns {Promise} resolves when the project is loaded.
 */
const reloadWithProjectJson = async (vm, projectJson) => {
    const sb3 = await vm.saveProjectSb3();
    const zip = await JSZip.loadAsync(await sb3.arrayBuffer());
    zip.file('project.json', JSON.stringify(projectJson));
    await reloadProject(vm, await zip.generateAsync({type: 'arraybuffer'}));
};

export {reloadProject, reloadWithProjectJson};
