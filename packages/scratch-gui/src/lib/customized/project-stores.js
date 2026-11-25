// CUSTOM: the project stores the editor offers, created once per page.
import {
    createDriveStore,
    createFolderStore,
    createIndexedDbStore,
    googleIdentityTokenProvider
} from '@scratch-customized/platform';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

let stores = null;

/**
 * @returns {{browser: ProjectStore, folder: FolderStore, drive: ?ProjectStore}} the stores. `drive` is null
 * when this build has no Google OAuth client ID.
 */
const getProjectStores = () => {
    stores ??= {
        browser: createIndexedDbStore(),
        folder: createFolderStore(),
        drive: GOOGLE_CLIENT_ID ? createDriveStore({getToken: googleIdentityTokenProvider(GOOGLE_CLIENT_ID)}) : null
    };
    return stores;
};

export {getProjectStores};
