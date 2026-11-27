// CUSTOM: a picture of the stage, saved beside a project as its cover on the My Projects page.
import {getProjectThumbnail} from '../store-project-thumbnail';

/**
 * @param {VirtualMachine} vm - the VM whose stage to capture.
 * @returns {Promise<Blob>} the stage as a PNG, at the standard stage size.
 */
const captureThumbnail = vm => new Promise((resolve, reject) => {
    getProjectThumbnail(vm, dataUrl => {
        fetch(dataUrl)
            .then(response => response.blob())
            .then(resolve, reject);
    });
});

export {captureThumbnail};
