// CUSTOM: Blockly definitions and workspace behavior for Custom mode.
/* eslint-disable @typescript-eslint/no-invalid-this -- Blockly calls block methods with the block as `this`. */
import {
    CONDITION_OPCODE,
    EXPRESSION_FIELD,
    EXPRESSION_OPCODE,
    ExprSyntaxError,
    MOUSE_UP_OPCODE,
    isBooleanNode,
    localVariableName,
    namesIn,
    parseExpression,
    parseLocalVariableName
} from '@scratch-customized/platform';
import {getEditorMode, usesCustomBlocks} from './editor-mode';

// Distinct colors so a variable's scope is visible at a glance. Global variables keep Scratch's orange.
const SCOPE_STYLES = {
    data_private: {
        colourPrimary: '#0E9F95',
        colourSecondary: '#0B8B82',
        colourTertiary: '#08756D',
        colourQuaternary: '#08756D'
    },
    data_blocklocal: {
        colourPrimary: '#A0693B',
        colourSecondary: '#8C5A31',
        colourTertiary: '#774C29',
        colourQuaternary: '#774C29'
    }
};

const MESSAGES = {
    expressionLabel: 'ƒ',
    mouseUp: 'mouse up?',
    globalHeading: '🌐 For all sprites (global)',
    privateHeading: '🔒 For this sprite only (private)',
    blockLocalHeading: '🧩 Block-local variables',
    blockLocalHint: 'Right-click a "define" block to add one.',
    addLocalVariable: 'Add block-local variable',
    localVariablePrompt: 'Name of the new block-local variable:',
    localVariableTitle: 'New block-local variable',
    needsCondition: 'Needs a true/false expression, such as "score > 10"',
    unknownName: name => `Unknown name "${name}" (it will count as 0)`
};

const customBlocksActive = () => usesCustomBlocks(getEditorMode());

/**
 * The custom block definition (proccode and parameter names) that encloses a block, if any.
 * @param {Blockly.Block} block - a block on a workspace.
 * @returns {?{proccode: string, params: string[]}} the enclosing definition.
 */
const enclosingProcedure = block => {
    const root = block.getRootBlock();
    if (!root || root.type !== 'procedures_definition') return null;
    const prototype = root.getInput('custom_block')?.connection?.targetBlock();
    if (!prototype) return null;
    return {proccode: prototype.procCode_ ?? '', params: prototype.displayNames_ ?? []};
};

/**
 * Problems with an expression, as a warning to show on its block, or null if there are none.
 * @param {Blockly.Block} block - the expression or condition block.
 * @param {string} source - the typed expression.
 * @returns {?string} the warning text.
 */
const expressionWarning = (block, source) => {
    let ast;
    try {
        ast = parseExpression(source);
    } catch (error) {
        if (error instanceof ExprSyntaxError) return `${error.message} (at position ${error.position + 1})`;
        throw error;
    }
    if (block.type === CONDITION_OPCODE && !isBooleanNode(ast)) return MESSAGES.needsCondition;
    if (!block.workspace || block.isInFlyout) return null;
    const procedure = enclosingProcedure(block);
    const variableNames = new Set(block.workspace.getVariablesOfType('').map(variable => variable.getName()));
    const unknown = namesIn(ast).find(name => {
        if (procedure?.params.includes(name)) return false;
        if (procedure && variableNames.has(localVariableName(procedure.proccode, name))) return false;
        return !variableNames.has(name);
    });
    return unknown ? MESSAGES.unknownName(unknown) : null;
};

const expressionBlock = (opcode, outputExtension) => ({
    init: function () {
        this.jsonInit({
            message0: `${MESSAGES.expressionLabel} %1`,
            args0: [{
                type: 'field_input',
                name: EXPRESSION_FIELD,
                text: opcode === CONDITION_OPCODE ? 'score > 10' : '(a + b) / 2',
                spellcheck: false
            }],
            extensions: ['colours_operators', outputExtension]
        });
        this.setOnChange(function () {
            if (this.isDeadOrDying()) return;
            this.setWarningText(expressionWarning(this, String(this.getFieldValue(EXPRESSION_FIELD) ?? '')));
        });
    }
});

/**
 * Define the editor-only blocks. They are always defined, so projects that contain them can be shown in any
 * mode; only the Custom-mode toolbox offers them.
 * @param {ScratchBlocks} ScratchBlocks - the scratch-blocks module.
 */
const defineCustomBlocks = ScratchBlocks => {
    ScratchBlocks.Blocks[EXPRESSION_OPCODE] = expressionBlock(EXPRESSION_OPCODE, 'output_string');
    ScratchBlocks.Blocks[CONDITION_OPCODE] = expressionBlock(CONDITION_OPCODE, 'output_boolean');
    ScratchBlocks.Blocks[MOUSE_UP_OPCODE] = {
        init: function () {
            this.jsonInit({
                message0: MESSAGES.mouseUp,
                extensions: ['colours_sensing', 'output_boolean']
            });
        }
    };
};

/**
 * Look up a variable in the main workspace. Flyout workspaces hold plain copies of variables without Scratch's
 * scope flags, so blocks in the palette must resolve their variables through the workspace they serve.
 * @param {Blockly.Workspace} workspace - the block's workspace (main or flyout).
 * @param {string} id - the variable ID.
 * @returns {?Blockly.IVariableModel} the variable.
 */
const lookupVariable = (workspace, id) => (workspace.targetWorkspace ?? workspace).getVariableById(id);

/**
 * @param {?Blockly.IVariableModel} variable - a scalar variable.
 * @returns {string} the block style for the variable's scope.
 */
const styleForVariable = variable => {
    if (!variable || !customBlocksActive()) return 'data';
    if (parseLocalVariableName(variable.getName())) return 'data_blocklocal';
    return variable.isLocal ? 'data_private' : 'data';
};

/**
 * Show block-local variables by their short name, and restyle a reporter when its variable changes.
 * @param {ScratchBlocks} ScratchBlocks - the scratch-blocks module.
 */
const patchVariableField = ScratchBlocks => {
    const FieldVariableGetter = ScratchBlocks.registry.getClass(
        ScratchBlocks.registry.Type.FIELD, 'field_variable_getter');
    if (!FieldVariableGetter) {
        throw new Error('patchVariableFields: scratch-blocks has no field_variable_getter field');
    }
    const originalGetText = FieldVariableGetter.prototype.getText;
    FieldVariableGetter.prototype.getText = function () {
        const text = originalGetText.call(this);
        if (!customBlocksActive()) return text;
        return parseLocalVariableName(text)?.name ?? text;
    };
    const originalUpdate = FieldVariableGetter.prototype.doValueUpdate_;
    FieldVariableGetter.prototype.doValueUpdate_ = function (newValue) {
        originalUpdate.call(this, newValue);
        const block = this.getSourceBlock();
        if (block?.type === 'data_variable') block.setStyle('data');
    };
};

/**
 * Color variable reporters by the scope of their variable.
 * @param {ScratchBlocks} ScratchBlocks - the scratch-blocks module.
 */
const patchVariableReporter = ScratchBlocks => {
    // Whenever a variable reporter is given the plain "data" style (by its colour extension, a theme refresh or
    // a variable change), use the style for its variable's scope instead.
    const reporter = ScratchBlocks.Blocks.data_variable;
    const originalInit = reporter.init;
    reporter.init = function () {
        const originalSetStyle = this.setStyle;
        this.setStyle = function (style) {
            const field = this.getField?.('VARIABLE');
            const variable = field && this.workspace ? lookupVariable(this.workspace, field.getValue()) : null;
            const scoped = style === 'data' ? styleForVariable(variable) : style;
            originalSetStyle.call(this, scoped);
        };
        originalInit.call(this);
    };
};

/**
 * Add the scope styles to a workspace's theme.
 * @param {Blockly.WorkspaceSvg} workspace - the main workspace.
 */
const registerScopeStyles = workspace => {
    const theme = workspace.getTheme();
    for (const [name, style] of Object.entries(SCOPE_STYLES)) {
        theme.setBlockStyle(name, style);
        theme.setBlockStyle(`${name}_selected`, {
            colourPrimary: style.colourQuaternary,
            colourSecondary: style.colourQuaternary,
            colourTertiary: style.colourQuaternary,
            colourQuaternary: style.colourQuaternary
        });
    }
    workspace.setTheme(theme);
};

const label = text => {
    const element = document.createElement('label');
    element.setAttribute('text', text);
    return element;
};

/**
 * Build the Variables palette for Custom mode: the stock palette with its variable reporters grouped by
 * scope under headings.
 * @param {ScratchBlocks} ScratchBlocks - the scratch-blocks module.
 * @returns {function(Blockly.WorkspaceSvg): Element[]} the toolbox category callback.
 */
const makeVariablesCategory = ScratchBlocks => workspace => {
    const stock = ScratchBlocks.ScratchVariables.getVariablesCategory(workspace);
    if (!customBlocksActive()) return stock;

    const isReporter = element => element.tagName.toLowerCase() === 'block' &&
        element.getAttribute('type') === 'data_variable';
    const firstReporter = stock.findIndex(isReporter);
    if (firstReporter < 0) return stock;
    const reporters = stock.filter(isReporter);
    const rest = stock.filter(element => !isReporter(element));

    const groups = {global: [], private: [], blockLocal: new Map()};
    for (const element of reporters) {
        const variable = lookupVariable(workspace, element.getAttribute('id'));
        const local = variable && parseLocalVariableName(variable.getName());
        element.setAttribute('gap', '8');
        if (local) {
            if (!groups.blockLocal.has(local.label)) groups.blockLocal.set(local.label, []);
            groups.blockLocal.get(local.label).push(element);
        } else if (variable?.isLocal) {
            groups.private.push(element);
        } else {
            groups.global.push(element);
        }
    }
    const grouped = [];
    if (groups.global.length) grouped.push(label(MESSAGES.globalHeading), ...groups.global);
    if (groups.private.length) grouped.push(label(MESSAGES.privateHeading), ...groups.private);
    grouped.push(label(MESSAGES.blockLocalHeading));
    if (groups.blockLocal.size === 0) grouped.push(label(MESSAGES.blockLocalHint));
    for (const [blockLabel, elements] of groups.blockLocal) grouped.push(label(`${blockLabel}:`), ...elements);
    grouped[grouped.length - 1].setAttribute('gap', '24');

    rest.splice(firstReporter, 0, ...grouped);
    return rest;
};

/**
 * Let the user add block-local variables from a "define" block's context menu.
 * @param {ScratchBlocks} ScratchBlocks - the scratch-blocks module.
 */
const addLocalVariableMenu = ScratchBlocks => {
    const definition = ScratchBlocks.Blocks.procedures_definition;
    const originalInit = definition.init;
    // The stock menu is set on each block by a mixin during init, so extend it there.
    definition.init = function () {
        originalInit.call(this);
        const originalMenu = this.customContextMenu;
        this.customContextMenu = function (options) {
            if (originalMenu) originalMenu.call(this, options);
            addLocalVariableOption.call(this, options);
        };
    };
    const addLocalVariableOption = function (options) {
        if (!customBlocksActive() || this.isInFlyout) return;
        const procedure = enclosingProcedure(this);
        if (!procedure?.proccode) return;
        const workspace = this.workspace;
        options.push({
            text: MESSAGES.addLocalVariable,
            enabled: true,
            callback: () => {
                ScratchBlocks.dialog.prompt(MESSAGES.localVariablePrompt, '', text => {
                    const name = (text ?? '').trim();
                    if (!name) return;
                    const fullName = localVariableName(procedure.proccode, name);
                    if (workspace.getVariable(fullName, '')) return;
                    const VariableModel = ScratchBlocks.registry.getClass(
                        ScratchBlocks.registry.Type.VARIABLE_MODEL, ScratchBlocks.registry.DEFAULT);
                    const variable = new VariableModel(workspace, fullName, '', null, true, false);
                    workspace.getVariableMap().addVariable(variable);
                    const VarCreate = ScratchBlocks.Events.get(ScratchBlocks.Events.VAR_CREATE);
                    ScratchBlocks.Events.fire(new VarCreate(variable));
                }, MESSAGES.localVariableTitle, ScratchBlocks.BROADCAST_MESSAGE_VARIABLE_TYPE);
            }
        });
    };
};

/**
 * Set up everything Custom mode needs in scratch-blocks. Call once, after scratch-blocks is loaded.
 * @param {ScratchBlocks} ScratchBlocks - the scratch-blocks module.
 */
let blocksSetUp = false;
const setupCustomBlocks = ScratchBlocks => {
    if (blocksSetUp) return;
    blocksSetUp = true;
    defineCustomBlocks(ScratchBlocks);
    patchVariableReporter(ScratchBlocks);
    addLocalVariableMenu(ScratchBlocks);
};

let fieldsPatched = false;
/**
 * Set up a freshly injected main workspace for Custom mode. scratch-blocks registers its field types during
 * `inject`, so the variable field is patched here rather than in setupCustomBlocks.
 * @param {ScratchBlocks} ScratchBlocks - the scratch-blocks module.
 * @param {Blockly.WorkspaceSvg} workspace - the main workspace.
 */
const setupWorkspace = (ScratchBlocks, workspace) => {
    if (!fieldsPatched) {
        fieldsPatched = true;
        patchVariableField(ScratchBlocks);
    }
    registerScopeStyles(workspace);
};

export {
    makeVariablesCategory,
    setupCustomBlocks,
    setupWorkspace
};
