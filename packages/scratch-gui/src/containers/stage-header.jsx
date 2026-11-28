import PropTypes from 'prop-types';
import React from 'react';
import bindAll from 'lodash.bindall';
import VM from '@scratch/scratch-vm';
import {STAGE_SIZE_MODES} from '../lib/layout-constants';
import {setStageSize} from '../reducers/stage-size';
import {setFullScreen} from '../reducers/mode';

import {connect} from 'react-redux';

import StageHeaderComponent from '../components/stage-header/stage-header.jsx';
import {showAlertWithTimeout, showStandardAlert} from '../reducers/alerts.js';
import {EDITOR_MODES} from '../lib/customized/editor-mode.js'; // CUSTOM
import {setAiAssistantVisible} from '../reducers/ai-assistant'; // CUSTOM

const ALERT_ID = {
    settingThumbnail: 'settingThumbnail',
    thumbnailSuccess: 'thumbnailSuccess',
    thumbnailError: 'thumbnailError'
};
 
class StageHeader extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleKeyPress',
            'handleToggleAiAssistant' // CUSTOM
        ]);
    }
    componentDidMount () {
        document.addEventListener('keydown', this.handleKeyPress);
    }
    componentWillUnmount () {
        document.removeEventListener('keydown', this.handleKeyPress);
    }
    handleKeyPress (event) {
        if (event.key === 'Escape' && this.props.isFullScreen) {
            this.props.onSetStageUnFull(false);
        }
    }
    // CUSTOM
    handleToggleAiAssistant () {
        this.props.onSetAiAssistantVisible(!this.props.aiAssistantVisible);
    }
    render () {
        const {
            onSetAiAssistantVisible, // eslint-disable-line no-unused-vars
            ...props
        } = this.props;
        return (
            <StageHeaderComponent
                {...props}
                onKeyPress={this.handleKeyPress}
                onToggleAiAssistant={this.handleToggleAiAssistant}
            />
        );
    }
}

StageHeader.propTypes = {
    aiAssistantVisible: PropTypes.bool, // CUSTOM
    onSetAiAssistantVisible: PropTypes.func, // CUSTOM
    isFullScreen: PropTypes.bool,
    isPlayerOnly: PropTypes.bool,
    onSetStageUnFull: PropTypes.func.isRequired,
    showBranding: PropTypes.bool,
    stageSizeMode: PropTypes.oneOf(Object.keys(STAGE_SIZE_MODES)),
    vm: PropTypes.instanceOf(VM).isRequired
};

const mapStateToProps = state => {
    const projectState = state.scratchGui.projectState;

    return {
        stageSizeMode: state.scratchGui.stageSize.stageSize,
        // CUSTOM: Custom mode resizes the stage by dragging its edge instead of the small/large toggle
        hideStageSizeToggle: state.scratchGui.editorMode === EDITOR_MODES.CUSTOM,
        aiAssistantVisible: state.scratchGui.aiAssistant.visible, // CUSTOM
        showBranding: state.scratchGui.mode.showBranding,
        isFullScreen: state.scratchGui.mode.isFullScreen,
        isPlayerOnly: state.scratchGui.mode.isPlayerOnly,

        projectId: projectState.projectId
    };

};

const mapDispatchToProps = dispatch => ({
    onSetStageLarge: () => dispatch(setStageSize(STAGE_SIZE_MODES.large)),
    onSetStageSmall: () => dispatch(setStageSize(STAGE_SIZE_MODES.small)),
    onSetStageFull: () => dispatch(setFullScreen(true)),
    onSetStageUnFull: () => dispatch(setFullScreen(false)),
    onSetAiAssistantVisible: visible => dispatch(setAiAssistantVisible(visible)), // CUSTOM
    onShowSettingThumbnail: () => dispatch(showStandardAlert(ALERT_ID.settingThumbnail)),
    onShowThumbnailSuccess: () => showAlertWithTimeout(dispatch, ALERT_ID.thumbnailSuccess),
    onShowThumbnailError: () => showAlertWithTimeout(dispatch, ALERT_ID.thumbnailError)
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(StageHeader);
