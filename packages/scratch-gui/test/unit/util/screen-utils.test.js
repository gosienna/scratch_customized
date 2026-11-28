import {getStageDimensions, stageSizeForWidth} from '../../../src/lib/screen-utils';
import {STAGE_DISPLAY_SIZES} from '../../../src/lib/layout-constants';
import {clampStageWidth, readStoredStageWidth} from '../../../src/lib/customized/stage-width';

describe('getStageDimensions', () => {
    test('a user-chosen width keeps the 4:3 aspect ratio', () => {
        expect(getStageDimensions(STAGE_DISPLAY_SIZES.large, false, 600)).toMatchObject({
            width: 600,
            height: 450,
            scale: 1.25
        });
    });

    test('without a width it uses the stage size enum', () => {
        expect(getStageDimensions(STAGE_DISPLAY_SIZES.small, false)).toMatchObject({width: 240, height: 180});
    });
});

test('stageSizeForWidth picks the closest stage size', () => {
    expect(stageSizeForWidth(300)).toBe(STAGE_DISPLAY_SIZES.small);
    expect(stageSizeForWidth(400)).toBe(STAGE_DISPLAY_SIZES.largeConstrained);
    expect(stageSizeForWidth(480)).toBe(STAGE_DISPLAY_SIZES.large);
    expect(stageSizeForWidth(900)).toBe(STAGE_DISPLAY_SIZES.large);
});

describe('stage width storage', () => {
    beforeEach(() => localStorage.clear());

    test('clampStageWidth keeps widths in range', () => {
        expect(clampStageWidth(10)).toBe(240);
        expect(clampStageWidth(5000)).toBe(960);
        expect(clampStageWidth(500.4)).toBe(500);
    });

    test('readStoredStageWidth falls back to the standard width for missing or invalid values', () => {
        expect(readStoredStageWidth()).toBe(480);
        localStorage.setItem('scratchCustomized.stageWidth', 'abc');
        expect(readStoredStageWidth()).toBe(480);
        localStorage.setItem('scratchCustomized.stageWidth', '640');
        expect(readStoredStageWidth()).toBe(640);
    });
});
