// CUSTOM: the places a project's Git history can be backed up (a local folder, a Google Drive folder), created
// once per page. Projects themselves are Git repositories in this browser (see project-repo.js).
import {
    createDriveStore,
    createFolderStore,
    googleIdentityTokenProvider
} from '@scratch-customized/platform';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
/** The Google Picker's API key and Cloud project number; without the key the Drive folder Picker is hidden. */
const GOOGLE_PICKER_API_KEY = process.env.GOOGLE_PICKER_API_KEY;
const GOOGLE_APP_ID = process.env.GOOGLE_APP_ID;

let stores = null;

/**
 * @returns {{folder: FolderStore, drive: ?DriveStore}} the stores. `drive` is null
 * when this build has no Google OAuth client ID.
 */
const getProjectStores = () => {
    stores ??= {
        folder: createFolderStore(),
        drive: GOOGLE_CLIENT_ID ? createDriveStore({getToken: googleIdentityTokenProvider(GOOGLE_CLIENT_ID)}) : null
    };
    return stores;
};

export {getProjectStores, GOOGLE_PICKER_API_KEY, GOOGLE_APP_ID};
