// CUSTOM: Text mode — edit the current sprite's scripts as Python-style or JavaScript-style code.
import PropTypes from 'prop-types';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {connect} from 'react-redux';
import {EditorView, basicSetup} from 'codemirror';
import {keymap} from '@codemirror/view';
import {Compartment, EditorState, Prec} from '@codemirror/state';
import {python} from '@codemirror/lang-python';
import {javascript} from '@codemirror/lang-javascript';
import {indentUnit} from '@codemirror/language';
import {applyText, targetToText, TextSyntaxError} from '@scratch-customized/platform';

import {EDITOR_MODES} from '../../lib/customized/editor-mode';
import {reloadWithProjectJson} from '../../lib/customized/reload-project';
import {setProjectChanged} from '../../reducers/project-changed';

import styles from './text-code-panel.css';

const DIALECT_KEY = 'scratchCustomized.textDialect';

const messages = defineMessages({
    python: {id: 'gui.customized.text.python', defaultMessage: 'Python style', description: 'Text dialect'},
    javascript: {id: 'gui.customized.text.javascript', defaultMessage: 'JavaScript style', description: 'Text dialect'},
    apply: {id: 'gui.customized.text.apply', defaultMessage: 'Apply to blocks', description: 'Button'},
    applyHint: {
        id: 'gui.customized.text.applyHint',
        defaultMessage: 'Ctrl+Enter / ⌘+Enter',
        description: 'Keyboard shortcut for applying text'
    },
    revert: {id: 'gui.customized.text.revert', defaultMessage: 'Undo my edits', description: 'Button'},
    unapplied: {
        id: 'gui.customized.text.unapplied',
        defaultMessage: 'Edits not applied yet — the sprite still runs the old code.',
        description: 'Status when text has changed'
    },
    applied: {id: 'gui.customized.text.applied', defaultMessage: 'Applied.', description: 'Status'},
    editing: {id: 'gui.customized.text.editing', defaultMessage: 'Code for {name}', description: 'Panel title'}
});

const readDialect = () => {
    try {
        return window.localStorage.getItem(DIALECT_KEY) === 'javascript' ? 'javascript' : 'python';
    } catch (e) {
        return 'python';
    }
};

// The printed code indents by 4 spaces (Python style) or 2 (JavaScript style); typing must match.
const languageFor = dialect => (dialect === 'javascript' ?
    [javascript(), indentUnit.of('  ')] :
    [python(), indentUnit.of('    ')]);

const currentTargetText = (vm, dialect) => {
    const target = vm.editingTarget;
    if (!target) return {name: '', text: ''};
    const project = JSON.parse(vm.toJSON());
    const json = project.targets.find(t => t.name === target.getName());
    return {name: target.getName(), text: json ? targetToText(json, dialect) : ''};
};

const TextCodePanel = ({vm, onProjectChanged}) => {
    const intl = useIntl();
    const containerRef = useRef(null);
    const viewRef = useRef(null);
    const languageRef = useRef(new Compartment());
    // Unapplied edits, by sprite name, so switching sprites does not lose them.
    const draftsRef = useRef(new Map());
    const [dialect, setDialect] = useState(readDialect);
    const [targetName, setTargetName] = useState('');
    const [generated, setGenerated] = useState('');
    const [dirty, setDirty] = useState(false);
    const [error, setError] = useState(null);
    const [status, setStatus] = useState(null);
    const stateRef = useRef({});
    stateRef.current = {dialect, targetName, generated};

    const setEditorText = useCallback(text => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({changes: {from: 0, to: view.state.doc.length, insert: text}});
    }, []);

    const showTarget = useCallback(() => {
        const {name, text} = currentTargetText(vm, stateRef.current.dialect);
        const draft = draftsRef.current.get(name);
        setTargetName(name);
        setGenerated(text);
        setError(null);
        setEditorText(draft ?? text);
        setDirty(Boolean(draft && draft !== text));
    }, [vm, setEditorText]);

    const apply = useCallback(async () => {
        const view = viewRef.current;
        const {dialect: currentDialect, targetName: name} = stateRef.current;
        if (!view || !name) return;
        const text = view.state.doc.toString();
        setStatus(null);
        try {
            const project = applyText(JSON.parse(vm.toJSON()), name, text, currentDialect);
            draftsRef.current.delete(name);
            await reloadWithProjectJson(vm, project);
            onProjectChanged();
            setStatus(intl.formatMessage(messages.applied));
        } catch (e) {
            if (!(e instanceof TextSyntaxError)) throw e;
            setError(e.message);
            const line = view.state.doc.line(Math.min(Math.max(e.line, 1), view.state.doc.lines));
            view.dispatch({selection: {anchor: line.from, head: line.to}, scrollIntoView: true});
            view.focus();
        }
    }, [vm, intl, onProjectChanged]);

    // Create the editor once.
    useEffect(() => {
        const view = new EditorView({
            parent: containerRef.current,
            state: EditorState.create({
                doc: '',
                extensions: [
                    basicSetup,
                    languageRef.current.of(languageFor(stateRef.current.dialect)),
                    // Above the default keymap, which uses Mod-Enter to insert a blank line.
                    Prec.highest(keymap.of([{
                        key: 'Mod-Enter',
                        run: () => {
                            apply();
                            return true;
                        }
                    }])),
                    EditorView.updateListener.of(update => {
                        if (!update.docChanged) return;
                        const text = update.state.doc.toString();
                        const {targetName: name, generated: original} = stateRef.current;
                        const changed = text !== original;
                        if (changed) draftsRef.current.set(name, text);
                        else draftsRef.current.delete(name);
                        setDirty(changed);
                    })
                ]
            })
        });
        viewRef.current = view;
        return () => {
            view.destroy();
            viewRef.current = null;
        };
    }, [apply]);

    // Follow the selected sprite and project loads.
    useEffect(() => {
        showTarget();
        vm.on('workspaceUpdate', showTarget);
        return () => vm.removeListener('workspaceUpdate', showTarget);
    }, [vm, showTarget]);

    const handleDialectChange = useCallback(event => {
        const next = event.target.value;
        try {
            window.localStorage.setItem(DIALECT_KEY, next);
        } catch (e) {
            // Not remembered; the choice still applies now.
        }
        draftsRef.current.clear();
        setStatus(null);
        stateRef.current.dialect = next;
        setDialect(next);
        viewRef.current?.dispatch({effects: languageRef.current.reconfigure(languageFor(next))});
        showTarget();
    }, [showTarget]);

    const handleApply = useCallback(() => {
        apply();
    }, [apply]);

    const handleRevert = useCallback(() => {
        draftsRef.current.delete(stateRef.current.targetName);
        showTarget();
    }, [showTarget]);

    return (
        <div className={styles.panel}>
            <div className={styles.toolbar}>
                <span className={styles.title}>{intl.formatMessage(messages.editing, {name: targetName})}</span>
                <select
                    className={styles.dialect}
                    value={dialect}
                    onChange={handleDialectChange}
                >
                    <option value="python">{intl.formatMessage(messages.python)}</option>
                    <option value="javascript">{intl.formatMessage(messages.javascript)}</option>
                </select>
                <button
                    className={styles.revert}
                    disabled={!dirty}
                    onClick={handleRevert}
                >
                    {intl.formatMessage(messages.revert)}
                </button>
                <button
                    className={styles.apply}
                    title={intl.formatMessage(messages.applyHint)}
                    onClick={handleApply}
                >
                    {intl.formatMessage(messages.apply)}
                </button>
            </div>
            {error && <div className={styles.error}>{error}</div>}
            {!error && dirty && <div className={styles.notice}>{intl.formatMessage(messages.unapplied)}</div>}
            {!error && !dirty && status && <div className={styles.status}>{status}</div>}
            <div
                className={styles.editor}
                ref={containerRef}
            />
        </div>
    );
};

TextCodePanel.propTypes = {
    vm: PropTypes.shape({
        editingTarget: PropTypes.object,
        on: PropTypes.func,
        removeListener: PropTypes.func,
        toJSON: PropTypes.func
    }).isRequired,
    onProjectChanged: PropTypes.func.isRequired
};

/* eslint-disable react/prop-types -- props of the connected wrapper, passed straight through. */
const TextCodePanelWrapper = ({editorMode, ...props}) => (editorMode === EDITOR_MODES.TEXT ? (
    <TextCodePanel {...props} />
) : null);
/* eslint-enable react/prop-types */

const mapStateToProps = state => ({
    editorMode: state.scratchGui.editorMode,
    vm: state.scratchGui.vm
});

const mapDispatchToProps = dispatch => ({
    onProjectChanged: () => dispatch(setProjectChanged())
});

export default connect(mapStateToProps, mapDispatchToProps)(TextCodePanelWrapper);
