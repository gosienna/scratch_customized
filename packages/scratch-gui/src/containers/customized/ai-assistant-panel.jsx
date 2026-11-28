// CUSTOM: the AI assistant, a chat panel on the right of the editor. Claude can read the project, test-run it
// and read console errors (see packages/platform/src/assistant). It changes the project (code, sprites, costumes)
// only while the learner has turned that on in Settings.
import PropTypes from 'prop-types';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {defineMessages, FormattedMessage, useIntl} from 'react-intl';
import {connect} from 'react-redux';
import {ASSISTANT_MODELS, createAssistant} from '@scratch-customized/platform';

import {createEditorView} from '../../lib/customized/ai-editor-view';
import {createProjectEditor} from '../../lib/customized/ai-project-editor';
import {setAiAssistantVisible} from '../../reducers/ai-assistant';
import {activateTab, BLOCKS_TAB_INDEX} from '../../reducers/editor-tab';
import {setProjectChanged} from '../../reducers/project-changed';

import styles from './ai-assistant-panel.css';

const API_KEY_KEY = 'scratchCustomized.anthropicApiKey';
const MODEL_KEY = 'scratchCustomized.aiAssistantModel';

const readModelChoice = () => {
    try {
        const choice = window.localStorage.getItem(MODEL_KEY);
        return Object.hasOwn(ASSISTANT_MODELS, choice) ? choice : 'haiku';
    } catch (e) {
        return 'haiku';
    }
};

const storeModelChoice = choice => {
    try {
        window.localStorage.setItem(MODEL_KEY, choice);
    } catch (e) {
        // Storage can be refused (private browsing); the choice then lasts for this visit only.
    }
};

const readApiKey = () => {
    try {
        return window.localStorage.getItem(API_KEY_KEY) || '';
    } catch (e) {
        return '';
    }
};

const storeApiKey = key => {
    try {
        if (key) window.localStorage.setItem(API_KEY_KEY, key);
        else window.localStorage.removeItem(API_KEY_KEY);
    } catch (e) {
        // Storage can be refused (private browsing); the key then lasts for this visit only.
    }
};

const messages = defineMessages({
    title: {id: 'gui.customized.ai.title', defaultMessage: 'Helper', description: 'AI assistant panel title'},
    close: {id: 'gui.customized.ai.close', defaultMessage: 'Close', description: 'Close the AI assistant panel'},
    newChat: {id: 'gui.customized.ai.newChat', defaultMessage: 'New chat', description: 'Button'},
    settings: {id: 'gui.customized.ai.settings', defaultMessage: 'API key', description: 'Button to change the key'},
    placeholder: {
        id: 'gui.customized.ai.placeholder',
        defaultMessage: 'Ask about your project…',
        description: 'Placeholder of the AI assistant message box'
    },
    send: {id: 'gui.customized.ai.send', defaultMessage: 'Send', description: 'Button'},
    stop: {id: 'gui.customized.ai.stop', defaultMessage: 'Stop', description: 'Button that stops the reply'},
    welcome: {
        id: 'gui.customized.ai.welcome',
        defaultMessage: 'Hi! Ask me why your project does something, or how to make it do something new. ' +
            'I can look at your sprites, run your project to test it, and read error messages.',
        description: 'First message shown in the AI assistant panel'
    },
    keyIntro: {
        id: 'gui.customized.ai.keyIntro',
        defaultMessage: 'The helper uses Claude. Paste an Anthropic API key to start. ' +
            'The key is kept only in this browser and is sent only to Anthropic.',
        description: 'Explains the API key form'
    },
    keyLink: {
        id: 'gui.customized.ai.keyLink',
        defaultMessage: 'Get a key at console.anthropic.com',
        description: 'Link to the Anthropic console'
    },
    keyLabel: {id: 'gui.customized.ai.keyLabel', defaultMessage: 'API key', description: 'Label'},
    saveKey: {id: 'gui.customized.ai.saveKey', defaultMessage: 'Save key', description: 'Button'},
    forgetKey: {id: 'gui.customized.ai.forgetKey', defaultMessage: 'Forget key', description: 'Button'},
    cancel: {id: 'gui.customized.ai.cancel', defaultMessage: 'Cancel', description: 'Button'},
    toolOverview: {
        id: 'gui.customized.ai.tool.overview',
        defaultMessage: 'Looked at the project',
        description: 'Tool call row'
    },
    toolScripts: {
        id: 'gui.customized.ai.tool.scripts',
        defaultMessage: 'Read the scripts of {sprite}',
        description: 'Tool call row'
    },
    model: {id: 'gui.customized.ai.model', defaultMessage: 'Model', description: 'Label of the Claude model picker'},
    modelHaiku: {
        id: 'gui.customized.ai.model.haiku',
        defaultMessage: 'Haiku (fastest, cheapest)',
        description: 'Claude model choice'
    },
    modelSonnet: {
        id: 'gui.customized.ai.model.sonnet',
        defaultMessage: 'Sonnet (balanced)',
        description: 'Claude model choice'
    },
    modelOpus: {
        id: 'gui.customized.ai.model.opus',
        defaultMessage: 'Opus (smartest, most expensive)',
        description: 'Claude model choice'
    },
    canEditBadge: {
        id: 'gui.customized.ai.canEditBadge',
        defaultMessage: 'Can edit',
        description: 'Badge in the AI helper header while it may change the project'
    },
    canEditWelcome: {
        id: 'gui.customized.ai.canEditWelcome',
        defaultMessage: 'Editing is on: when you ask, I can write code, create sprites and draw costumes. ' +
            'You can undo my changes from History. Turn this off in Settings > AI helper.',
        description: 'Second welcome paragraph while the AI helper may change the project'
    },
    toolSetCode: {
        id: 'gui.customized.ai.tool.setCode',
        defaultMessage: 'Changed the code of {sprite}',
        description: 'Tool call row'
    },
    toolCreateSprite: {
        id: 'gui.customized.ai.tool.createSprite',
        defaultMessage: 'Created sprite {name}',
        description: 'Tool call row'
    },
    toolAddCostume: {
        id: 'gui.customized.ai.tool.addCostume',
        defaultMessage: 'Added costume "{name}" to {sprite}',
        description: 'Tool call row'
    },
    toolAddComment: {
        id: 'gui.customized.ai.tool.addComment',
        defaultMessage: 'Added a comment to {sprite}',
        description: 'Tool call row'
    },
    toolOpenSprite: {
        id: 'gui.customized.ai.tool.openSprite',
        defaultMessage: 'Opened {sprite}',
        description: 'Tool call row'
    },
    toolShowCode: {
        id: 'gui.customized.ai.tool.showCode',
        defaultMessage: 'Showed you code in {sprite}',
        description: 'Tool call row'
    },
    toolCostume: {
        id: 'gui.customized.ai.tool.costume',
        defaultMessage: 'Looked at costume "{costume}" of {sprite}',
        description: 'Tool call row'
    },
    toolRunProject: {
        id: 'gui.customized.ai.tool.runProject',
        defaultMessage: 'Ran the project (up to {seconds} s)',
        description: 'Tool call row'
    },
    toolRunScript: {
        id: 'gui.customized.ai.tool.runScript',
        defaultMessage: 'Ran a script of {sprite} (up to {seconds} s)',
        description: 'Tool call row'
    },
    toolLogs: {
        id: 'gui.customized.ai.tool.logs',
        defaultMessage: 'Read the console messages',
        description: 'Tool call row'
    },
    toolOther: {id: 'gui.customized.ai.tool.other', defaultMessage: 'Used {name}', description: 'Tool call row'},
    toolRunning: {id: 'gui.customized.ai.tool.running', defaultMessage: 'working…', description: 'Tool status'},
    toolFinished: {id: 'gui.customized.ai.tool.finished', defaultMessage: 'finished', description: 'Tool status'},
    toolStopped: {
        id: 'gui.customized.ai.tool.stopped',
        defaultMessage: 'stopped after {seconds} s',
        description: 'Tool status: a test run was stopped at its time limit'
    },
    toolFailed: {id: 'gui.customized.ai.tool.failed', defaultMessage: 'failed', description: 'Tool status'},
    errorAuth: {
        id: 'gui.customized.ai.error.auth',
        defaultMessage: 'Anthropic did not accept the API key. Check it under "API key".',
        description: 'Error'
    },
    errorPermission: {
        id: 'gui.customized.ai.error.permission',
        defaultMessage: 'This API key is not allowed to use the helper model.',
        description: 'Error'
    },
    errorRateLimit: {
        id: 'gui.customized.ai.error.rateLimit',
        defaultMessage: 'Too many requests right now. Wait a minute and try again.',
        description: 'Error'
    },
    errorOverloaded: {
        id: 'gui.customized.ai.error.overloaded',
        defaultMessage: 'Claude is busy right now. Try again in a moment.',
        description: 'Error'
    },
    errorConnection: {
        id: 'gui.customized.ai.error.connection',
        defaultMessage: 'Could not reach Anthropic. Check your internet connection.',
        description: 'Error'
    },
    errorOther: {
        id: 'gui.customized.ai.error.other',
        defaultMessage: 'Something went wrong: {message}',
        description: 'Error'
    },
    noticeRefusal: {
        id: 'gui.customized.ai.notice.refusal',
        defaultMessage: 'The helper cannot answer that. Try asking about your project.',
        description: 'Notice'
    },
    noticeMaxTokens: {
        id: 'gui.customized.ai.notice.maxTokens',
        defaultMessage: 'The answer was too long and was cut off.',
        description: 'Notice'
    },
    noticeTooManySteps: {
        id: 'gui.customized.ai.notice.tooManySteps',
        defaultMessage: 'The helper stopped after many steps. Ask again to let it continue.',
        description: 'Notice'
    },
    noticeAborted: {id: 'gui.customized.ai.notice.aborted', defaultMessage: 'Stopped.', description: 'Notice'}
});

const ERROR_MESSAGES = {
    auth: messages.errorAuth,
    permission: messages.errorPermission,
    rate_limit: messages.errorRateLimit,
    overloaded: messages.errorOverloaded,
    connection: messages.errorConnection
};

const NOTICE_MESSAGES = {
    refusal: messages.noticeRefusal,
    max_tokens: messages.noticeMaxTokens,
    too_many_steps: messages.noticeTooManySteps,
    aborted: messages.noticeAborted
};

const toolLabel = (intl, {name, input}) => {
    switch (name) {
    case 'get_project_overview': return intl.formatMessage(messages.toolOverview);
    case 'get_sprite_scripts': return intl.formatMessage(messages.toolScripts, {sprite: input.sprite});
    case 'get_costume_image':
        return intl.formatMessage(messages.toolCostume, {sprite: input.sprite, costume: input.costume});
    case 'set_sprite_code': return intl.formatMessage(messages.toolSetCode, {sprite: input.sprite});
    case 'create_sprite': return intl.formatMessage(messages.toolCreateSprite, {name: input.name});
    case 'add_costume': return intl.formatMessage(messages.toolAddCostume, {name: input.name, sprite: input.sprite});
    case 'add_comment': return intl.formatMessage(messages.toolAddComment, {sprite: input.sprite});
    case 'open_sprite': return intl.formatMessage(messages.toolOpenSprite, {sprite: input.sprite});
    case 'show_in_workspace': return intl.formatMessage(messages.toolShowCode, {sprite: input.sprite});
    case 'run_project': return intl.formatMessage(messages.toolRunProject, {seconds: input.seconds});
    case 'run_script':
        return intl.formatMessage(messages.toolRunScript, {sprite: input.sprite, seconds: input.seconds});
    case 'get_console_logs': return intl.formatMessage(messages.toolLogs);
    default: return intl.formatMessage(messages.toolOther, {name});
    }
};

const toolStatus = (intl, item) => {
    if (item.status === 'running') return intl.formatMessage(messages.toolRunning);
    if (item.status === 'error') return intl.formatMessage(messages.toolFailed);
    if (item.name === 'run_project' || item.name === 'run_script') {
        try {
            const report = JSON.parse(item.result);
            if (!report.finished) return intl.formatMessage(messages.toolStopped, {seconds: report.seconds});
        } catch (e) {
            // Not a run report; show it as finished.
        }
    }
    return intl.formatMessage(messages.toolFinished);
};

const prettyResult = text => {
    try {
        return JSON.stringify(JSON.parse(text), null, 2);
    } catch (e) {
        return text;
    }
};

/** `code` and **bold** inside one line of a reply. */
const renderInline = text => text.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
        return <code key={i}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 3) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
});

/** A small Markdown subset for replies: paragraphs, bullet and numbered lists, and fenced code blocks. */
const renderReply = text => {
    const elements = [];
    const parts = text.split(/```[^\n]*\n?/);
    parts.forEach((part, partIndex) => {
        if (partIndex % 2 === 1) {
            elements.push(<pre key={`c${partIndex}`}><code>{part.replace(/\n$/, '')}</code></pre>);
            return;
        }
        part.split(/\n{2,}/).forEach((block, blockIndex) => {
            const lines = block.split('\n').filter(line => line.trim() !== '');
            if (lines.length === 0) return;
            const key = `b${partIndex}-${blockIndex}`;
            if (lines.every(line => /^\s*[-*] /.test(line))) {
                elements.push(<ul key={key}>{lines.map((line, i) => (
                    <li key={i}>{renderInline(line.replace(/^\s*[-*] /, ''))}</li>
                ))}</ul>);
            } else if (lines.every(line => /^\s*\d+[.)] /.test(line))) {
                elements.push(<ol key={key}>{lines.map((line, i) => (
                    <li key={i}>{renderInline(line.replace(/^\s*\d+[.)] /, ''))}</li>
                ))}</ol>);
            } else {
                elements.push(<p key={key}>{lines.map((line, i) => (
                    <React.Fragment key={i}>
                        {i > 0 ? <br /> : null}
                        {renderInline(line.replace(/^#+\s*/, ''))}
                    </React.Fragment>
                ))}</p>);
            }
        });
    });
    return elements;
};

const KeyForm = ({hasKey, onCancel, onSave}) => {
    const intl = useIntl();
    const [value, setValue] = useState('');
    const handleChange = useCallback(e => setValue(e.target.value), []);
    const handleSubmit = useCallback(e => {
        e.preventDefault();
        if (value.trim()) onSave(value.trim());
    }, [value, onSave]);
    const handleForget = useCallback(() => onSave(''), [onSave]);
    return (
        <form
            className={styles.keyForm}
            onSubmit={handleSubmit}
        >
            <p>{intl.formatMessage(messages.keyIntro)}</p>
            <a
                href="https://console.anthropic.com/settings/keys"
                rel="noopener noreferrer"
                target="_blank"
            >
                {intl.formatMessage(messages.keyLink)}
            </a>
            <label className={styles.keyLabel}>
                {intl.formatMessage(messages.keyLabel)}
                <input
                    autoComplete="off"
                    className={styles.keyInput}
                    placeholder="sk-ant-…"
                    type="password"
                    value={value}
                    onChange={handleChange}
                />
            </label>
            <div className={styles.keyButtons}>
                <button
                    className={styles.primaryButton}
                    disabled={!value.trim()}
                    type="submit"
                >
                    {intl.formatMessage(messages.saveKey)}
                </button>
                {hasKey ? (
                    <React.Fragment>
                        <button
                            className={styles.button}
                            type="button"
                            onClick={handleForget}
                        >
                            {intl.formatMessage(messages.forgetKey)}
                        </button>
                        <button
                            className={styles.button}
                            type="button"
                            onClick={onCancel}
                        >
                            {intl.formatMessage(messages.cancel)}
                        </button>
                    </React.Fragment>
                ) : null}
            </div>
        </form>
    );
};

KeyForm.propTypes = {
    hasKey: PropTypes.bool.isRequired,
    onCancel: PropTypes.func.isRequired,
    onSave: PropTypes.func.isRequired
};

const ChatItem = ({item}) => {
    const intl = useIntl();
    switch (item.kind) {
    case 'user':
        return <div className={styles.userBubble}>{item.text}</div>;
    case 'assistant':
        return <div className={styles.assistantBubble}>{renderReply(item.text)}</div>;
    case 'tool':
        return (
            <details className={styles.tool}>
                <summary>
                    <span className={styles.toolName}>{toolLabel(intl, item)}</span>
                    {' — '}
                    <span className={item.status === 'error' ? styles.toolError : styles.toolStatus}>
                        {toolStatus(intl, item)}
                    </span>
                </summary>
                {item.image ? (
                    <img
                        alt={toolLabel(intl, item)}
                        className={styles.toolImage}
                        src={`data:${item.image.mediaType};base64,${item.image.data}`}
                    />
                ) : null}
                {item.result ? <pre className={styles.toolResult}>{prettyResult(item.result)}</pre> : null}
            </details>
        );
    case 'notice':
        return <div className={item.isError ? styles.error : styles.notice}>{item.text}</div>;
    default:
        return null;
    }
};

ChatItem.propTypes = {
    item: PropTypes.shape({
        kind: PropTypes.oneOf(['user', 'assistant', 'tool', 'notice']).isRequired,
        text: PropTypes.string,
        name: PropTypes.string,
        input: PropTypes.object, // eslint-disable-line react/forbid-prop-types
        status: PropTypes.oneOf(['running', 'ok', 'error']),
        result: PropTypes.string,
        image: PropTypes.shape({mediaType: PropTypes.string, data: PropTypes.string}),
        isError: PropTypes.bool
    }).isRequired
};

const AiAssistantPanel = ({canEdit, editorMode, onActivateBlocksTab, onClose, onProjectChanged, vm}) => {
    const intl = useIntl();
    const [apiKey, setApiKey] = useState(readApiKey);
    const [editingKey, setEditingKey] = useState(!apiKey);
    const [items, setItems] = useState([]);
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const assistantRef = useRef(null);
    const listRef = useRef(null);
    const editorModeRef = useRef(editorMode);
    editorModeRef.current = editorMode;
    // Read on every message, so turning editing on or off applies without starting a new chat.
    const canEditRef = useRef(canEdit);
    canEditRef.current = canEdit;
    const [modelChoice, setModelChoice] = useState(readModelChoice);
    const modelRef = useRef(modelChoice);
    modelRef.current = modelChoice;
    const handleModelChange = useCallback(e => {
        storeModelChoice(e.target.value);
        setModelChoice(e.target.value);
    }, []);
    const onProjectChangedRef = useRef(onProjectChanged);
    onProjectChangedRef.current = onProjectChanged;
    const onActivateBlocksTabRef = useRef(onActivateBlocksTab);
    onActivateBlocksTabRef.current = onActivateBlocksTab;

    useEffect(() => {
        const editor = createProjectEditor(vm, () => onProjectChangedRef.current());
        const view = createEditorView(vm, {
            activateBlocksTab: () => onActivateBlocksTabRef.current(),
            editorMode: () => editorModeRef.current
        });
        assistantRef.current = apiKey ? createAssistant({
            apiKey,
            vm,
            editorMode: () => editorModeRef.current,
            model: () => ASSISTANT_MODELS[modelRef.current],
            editor: () => (canEditRef.current ? editor : null),
            view: () => view
        }) : null;
        return () => assistantRef.current?.abort();
    }, [apiKey, vm]);

    useEffect(() => {
        const list = listRef.current;
        if (list) list.scrollTop = list.scrollHeight;
    }, [items]);

    const handleSaveKey = useCallback(key => {
        storeApiKey(key);
        setApiKey(key);
        setEditingKey(!key);
        setItems([]);
    }, []);
    const handleEditKey = useCallback(() => setEditingKey(true), []);
    const handleCancelKey = useCallback(() => setEditingKey(false), []);

    const handleNewChat = useCallback(() => {
        assistantRef.current?.reset();
        setItems([]);
        setBusy(false);
    }, []);

    const handleStop = useCallback(() => assistantRef.current?.abort(), []);

    const handleSend = useCallback(async () => {
        const text = draft.trim();
        const assistant = assistantRef.current;
        if (!text || busy || !assistant) return;
        setDraft('');
        setBusy(true);
        setItems(current => [...current, {kind: 'user', text}]);
        const appendText = delta => setItems(current => {
            const last = current[current.length - 1];
            if (last && last.kind === 'assistant') {
                return [...current.slice(0, -1), {...last, text: last.text + delta}];
            }
            return [...current, {kind: 'assistant', text: delta}];
        });
        const updateTool = (id, changes) => setItems(current => current.map(item => (
            item.kind === 'tool' && item.id === id ? {...item, ...changes} : item
        )));
        try {
            const {notice} = await assistant.send(text, {
                onText: appendText,
                onToolStart: call => setItems(current => [...current, {kind: 'tool', status: 'running', ...call}]),
                onToolEnd: (call, result) => updateTool(call.id, {
                    status: result.ok ? 'ok' : 'error',
                    result: result.text,
                    image: result.image
                })
            });
            if (notice) {
                setItems(current => [...current, {kind: 'notice', text: intl.formatMessage(NOTICE_MESSAGES[notice])}]);
            }
        } catch (error) {
            const message = ERROR_MESSAGES[error.kind];
            const shown = message ? intl.formatMessage(message) :
                intl.formatMessage(messages.errorOther, {message: error.message});
            setItems(current => [...current, {kind: 'notice', isError: true, text: shown}]);
        } finally {
            setBusy(false);
        }
    }, [busy, draft, intl]);

    const handleDraftChange = useCallback(e => setDraft(e.target.value), []);
    const handleKeyDown = useCallback(e => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            handleSend();
        }
    }, [handleSend]);

    return (
        <section
            aria-label={intl.formatMessage(messages.title)}
            className={styles.panel}
        >
            <header className={styles.header}>
                <span className={styles.title}>{intl.formatMessage(messages.title)}</span>
                {canEdit ? <span className={styles.badge}>{intl.formatMessage(messages.canEditBadge)}</span> : null}
                {apiKey && !editingKey ? (
                    <React.Fragment>
                        <button
                            className={styles.headerButton}
                            disabled={busy || items.length === 0}
                            onClick={handleNewChat}
                        >
                            {intl.formatMessage(messages.newChat)}
                        </button>
                        <button
                            className={styles.headerButton}
                            onClick={handleEditKey}
                        >
                            {intl.formatMessage(messages.settings)}
                        </button>
                    </React.Fragment>
                ) : null}
                <button
                    aria-label={intl.formatMessage(messages.close)}
                    className={styles.headerButton}
                    title={intl.formatMessage(messages.close)}
                    onClick={onClose}
                >
                    {'×'}
                </button>
            </header>
            <div className={styles.modelRow}>
                <label className={styles.modelLabel}>
                    {intl.formatMessage(messages.model)}
                    <select
                        className={styles.modelSelect}
                        value={modelChoice}
                        onChange={handleModelChange}
                    >
                        <option value="haiku">{intl.formatMessage(messages.modelHaiku)}</option>
                        <option value="sonnet">{intl.formatMessage(messages.modelSonnet)}</option>
                        <option value="opus">{intl.formatMessage(messages.modelOpus)}</option>
                    </select>
                </label>
            </div>
            {editingKey ? (
                <KeyForm
                    hasKey={Boolean(apiKey)}
                    onCancel={handleCancelKey}
                    onSave={handleSaveKey}
                />
            ) : (
                <React.Fragment>
                    <div
                        aria-live="polite"
                        className={styles.messages}
                        ref={listRef}
                    >
                        <div className={styles.assistantBubble}>
                            <p>
                                <FormattedMessage {...messages.welcome} />
                            </p>
                            {canEdit ? <p><FormattedMessage {...messages.canEditWelcome} /></p> : null}
                        </div>
                        {items.map((item, index) => (
                            <ChatItem
                                item={item}
                                key={index}
                            />
                        ))}
                    </div>
                    <div className={styles.composer}>
                        <textarea
                            className={styles.input}
                            placeholder={intl.formatMessage(messages.placeholder)}
                            rows={3}
                            value={draft}
                            onChange={handleDraftChange}
                            onKeyDown={handleKeyDown}
                        />
                        {busy ? (
                            <button
                                className={styles.button}
                                onClick={handleStop}
                            >
                                {intl.formatMessage(messages.stop)}
                            </button>
                        ) : (
                            <button
                                className={styles.primaryButton}
                                disabled={!draft.trim()}
                                onClick={handleSend}
                            >
                                {intl.formatMessage(messages.send)}
                            </button>
                        )}
                    </div>
                </React.Fragment>
            )}
        </section>
    );
};

AiAssistantPanel.propTypes = {
    canEdit: PropTypes.bool.isRequired,
    editorMode: PropTypes.string.isRequired,
    onActivateBlocksTab: PropTypes.func.isRequired,
    onClose: PropTypes.func.isRequired,
    onProjectChanged: PropTypes.func.isRequired,
    vm: PropTypes.object.isRequired // eslint-disable-line react/forbid-prop-types
};

const mapStateToProps = state => ({
    canEdit: state.scratchGui.aiAssistant.canEdit,
    editorMode: state.scratchGui.editorMode,
    vm: state.scratchGui.vm
});

const mapDispatchToProps = dispatch => ({
    onActivateBlocksTab: () => dispatch(activateTab(BLOCKS_TAB_INDEX)),
    onClose: () => dispatch(setAiAssistantVisible(false)),
    onProjectChanged: () => dispatch(setProjectChanged())
});

export default connect(mapStateToProps, mapDispatchToProps)(AiAssistantPanel);
