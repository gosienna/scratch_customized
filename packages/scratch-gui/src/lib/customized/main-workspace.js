// CUSTOM: the code area's Blockly workspace, kept by the Blocks container so the AI helper can scroll it.
let mainWorkspace = null;

/** @param {object|null} workspace - the injected workspace, or null once it is disposed. */
const setMainWorkspace = workspace => {
    mainWorkspace = workspace;
};

/** @returns {object|null} the code area's workspace, or null while there is none. */
const getMainWorkspace = () => mainWorkspace;

export {getMainWorkspace, setMainWorkspace};
