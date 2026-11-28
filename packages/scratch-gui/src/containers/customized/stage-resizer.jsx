// CUSTOM: a handle on the edge between the code area and the stage; dragging it changes the stage width.
import PropTypes from 'prop-types';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {connect} from 'react-redux';
import classNames from 'classnames';

import {setStageWidth} from '../../reducers/stage-size';
import {MAX_STAGE_WIDTH, MIN_STAGE_WIDTH, clampStageWidth, storeStageWidth} from '../../lib/customized/stage-width';

import styles from './stage-resizer.css';

const messages = defineMessages({
    label: {
        id: 'gui.customized.stageResizer.label',
        defaultMessage: 'Resize stage',
        description: 'Accessibility label for the handle that changes the stage width by dragging'
    }
});

// The code area must keep this much width (the `flex-basis` of `.editor-wrapper` in gui.css),
// plus room for the stage column's padding and borders.
const MIN_CODE_AREA_WIDTH = 616;
const STAGE_COLUMN_EXTRA = 40;
const KEYBOARD_STEP = 20;

const maxWidthForWindow = () => Math.min(
    MAX_STAGE_WIDTH,
    Math.max(MIN_STAGE_WIDTH, window.innerWidth - MIN_CODE_AREA_WIDTH - STAGE_COLUMN_EXTRA)
);

const fitWidth = width => Math.min(clampStageWidth(width), maxWidthForWindow());

const StageResizer = ({isRtl, stageWidth, onSetStageWidth}) => {
    const intl = useIntl();
    const [isDragging, setIsDragging] = useState(false);
    const drag = useRef(null);
    const frame = useRef(null);

    // Blockly and the stage measure themselves on window resize, so announce every width change.
    useEffect(() => {
        window.dispatchEvent(new Event('resize'));
    }, [stageWidth]);

    useEffect(() => () => cancelAnimationFrame(frame.current), []);

    const handlePointerDown = useCallback(event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {startX: event.clientX, startWidth: stageWidth, width: stageWidth};
        document.body.style.userSelect = 'none';
        setIsDragging(true);
    }, [stageWidth]);

    const handlePointerMove = useCallback(event => {
        if (!drag.current) return;
        // The stage is to the right of the handle (left in RTL), so moving toward it shrinks the stage.
        const delta = isRtl ? event.clientX - drag.current.startX : drag.current.startX - event.clientX;
        drag.current.width = fitWidth(drag.current.startWidth + delta);
        if (frame.current) return;
        frame.current = requestAnimationFrame(() => {
            frame.current = null;
            if (drag.current) onSetStageWidth(drag.current.width);
        });
    }, [isRtl, onSetStageWidth]);

    const handlePointerUp = useCallback(() => {
        if (!drag.current) return;
        const {width} = drag.current;
        drag.current = null;
        document.body.style.userSelect = '';
        setIsDragging(false);
        onSetStageWidth(width);
        storeStageWidth(width);
    }, [onSetStageWidth]);

    const handleKeyDown = useCallback(event => {
        let direction = 0;
        if (event.key === 'ArrowLeft') direction = isRtl ? -1 : 1;
        else if (event.key === 'ArrowRight') direction = isRtl ? 1 : -1;
        if (!direction) return;
        event.preventDefault();
        const width = fitWidth(stageWidth + (direction * KEYBOARD_STEP));
        onSetStageWidth(width);
        storeStageWidth(width);
    }, [isRtl, stageWidth, onSetStageWidth]);

    return (
        <div
            aria-label={intl.formatMessage(messages.label)}
            aria-orientation="vertical"
            aria-valuemax={MAX_STAGE_WIDTH}
            aria-valuemin={MIN_STAGE_WIDTH}
            aria-valuenow={stageWidth}
            className={classNames(styles.resizer, {[styles.dragging]: isDragging})}
            role="separator"
            tabIndex={0}
            onKeyDown={handleKeyDown}
            onLostPointerCapture={handlePointerUp}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
        />
    );
};

StageResizer.propTypes = {
    isRtl: PropTypes.bool,
    onSetStageWidth: PropTypes.func.isRequired,
    stageWidth: PropTypes.number.isRequired
};

const mapStateToProps = state => ({
    stageWidth: state.scratchGui.stageSize.stageWidth
});

const mapDispatchToProps = dispatch => ({
    onSetStageWidth: width => dispatch(setStageWidth(width))
});

export default connect(mapStateToProps, mapDispatchToProps)(StageResizer);
