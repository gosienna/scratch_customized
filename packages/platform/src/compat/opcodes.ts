/** Opcodes that exist only inside this editor. They are never written to a saved file. */
export const EXPRESSION_OPCODE = 'operator_expression'
export const CONDITION_OPCODE = 'operator_condition'
export const MOUSE_UP_OPCODE = 'sensing_mouseup'

export const CUSTOM_OPCODES: ReadonlySet<string> = new Set([EXPRESSION_OPCODE, CONDITION_OPCODE, MOUSE_UP_OPCODE])

/** The field of an expression/condition block that holds the typed expression. */
export const EXPRESSION_FIELD = 'EXPR'

/** Extensions shipped with official Scratch 3 (scratch-vm's built-in extension IDs). */
export const OFFICIAL_EXTENSION_IDS: ReadonlySet<string> = new Set([
  'pen',
  'wedo2',
  'music',
  'microbit',
  'text2speech',
  'translate',
  'videoSensing',
  'ev3',
  'makeymakey',
  'boost',
  'gdxfor',
  'faceSensing',
])
