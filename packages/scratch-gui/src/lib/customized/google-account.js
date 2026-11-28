// CUSTOM: signing in to Google (for Drive backups), shared by the menu bar and the My Projects page so both show
// the signed-in account.
import log from '../log';
import {setGoogleAccount} from '../../reducers/project-storage';
import {getProjectStores} from './project-stores';

/**
 * Sign in with Google's popup, then record the account in the store.
 * @param {function(object): object} dispatch - the Redux dispatch function.
 * @returns {Promise<void>} resolves once signed in; rejects if the sign-in was not completed.
 */
const signInToGoogle = async dispatch => {
    const drive = getProjectStores().drive;
    if (!drive) throw new Error('signInToGoogle: this build has no Google OAuth client ID');
    await drive.connect();
    try {
        dispatch(setGoogleAccount(await drive.account()));
    } catch (e) {
        log.warn('signInToGoogle: signed in, but could not look up the Google account', e);
    }
};

export {signInToGoogle};
