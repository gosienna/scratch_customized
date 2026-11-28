import stageSizeReducer, {setStageSize, setStageWidth} from '../../../src/reducers/stage-size';
import {STAGE_DISPLAY_SIZES} from '../../../src/lib/layout-constants';

test('initial state has the standard stage width', () => {
    expect(stageSizeReducer(undefined, {})).toEqual({ // eslint-disable-line no-undefined
        stageSize: STAGE_DISPLAY_SIZES.large,
        stageWidth: 480
    });
});

test('setStageWidth keeps the stage size mode, and setStageSize keeps the width', () => {
    let state = stageSizeReducer(undefined, setStageWidth(600)); // eslint-disable-line no-undefined
    state = stageSizeReducer(state, setStageSize(STAGE_DISPLAY_SIZES.small));
    expect(state).toEqual({stageSize: STAGE_DISPLAY_SIZES.small, stageWidth: 600});
});
