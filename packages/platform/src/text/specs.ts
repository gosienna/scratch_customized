/**
 * The blocks that have a text form, with their argument order. One table serves both text dialects: names are
 * written in snake_case (Python) and converted to camelCase for JavaScript. Blocks missing here still round-trip
 * losslessly through `scratch_block(...)` / `scratch_value(...)`.
 */
import {
  ANGLE_NUM_PRIMITIVE,
  COLOR_PICKER_PRIMITIVE,
  INTEGER_NUM_PRIMITIVE,
  MATH_NUM_PRIMITIVE,
  POSITIVE_NUM_PRIMITIVE,
  TEXT_PRIMITIVE,
} from '../sb3/types'

export type ArgSpec =
  /** A number/text/colour slot with a primitive shadow. */
  | { input: string; primitive: number }
  /** A true/false slot. */
  | { input: string; boolean: true }
  /** A slot whose shadow is a menu block (written as the menu's value, e.g. "_mouse_"). */
  | { input: string; menu: string; field: string; default: string }
  /** A field on the block itself (written as a string). */
  | { field: string }
  /** A broadcast message (written as its name). */
  | { broadcastInput: string }
  | { broadcastField: string }
  /** A list, by name. */
  | { list: true }
  /** A variable, by name (show/hide variable). */
  | { variable: true }

export type BlockShape = 'statement' | 'cap' | 'reporter' | 'boolean' | 'hat'

export interface BlockSpec {
  opcode: string
  name: string
  shape: BlockShape
  args: ArgSpec[]
}

const N = (input: string): ArgSpec => ({ input, primitive: MATH_NUM_PRIMITIVE })
const P = (input: string): ArgSpec => ({ input, primitive: POSITIVE_NUM_PRIMITIVE })
const I = (input: string): ArgSpec => ({ input, primitive: INTEGER_NUM_PRIMITIVE })
const A = (input: string): ArgSpec => ({ input, primitive: ANGLE_NUM_PRIMITIVE })
const T = (input: string): ArgSpec => ({ input, primitive: TEXT_PRIMITIVE })
const C = (input: string): ArgSpec => ({ input, primitive: COLOR_PICKER_PRIMITIVE })
const B = (input: string): ArgSpec => ({ input, boolean: true })
const M = (input: string, menu: string, field: string, fallback: string): ArgSpec => ({
  input,
  menu,
  field,
  default: fallback,
})
const F = (field: string): ArgSpec => ({ field })
const LIST: ArgSpec = { list: true }
const VARIABLE: ArgSpec = { variable: true }

const s = (opcode: string, name: string, ...args: ArgSpec[]): BlockSpec => ({
  opcode,
  name,
  shape: 'statement',
  args,
})
const r = (opcode: string, name: string, ...args: ArgSpec[]): BlockSpec => ({ opcode, name, shape: 'reporter', args })
const b = (opcode: string, name: string, ...args: ArgSpec[]): BlockSpec => ({ opcode, name, shape: 'boolean', args })
const h = (opcode: string, name: string, ...args: ArgSpec[]): BlockSpec => ({ opcode, name, shape: 'hat', args })
const c = (opcode: string, name: string, ...args: ArgSpec[]): BlockSpec => ({ opcode, name, shape: 'cap', args })

export const BLOCK_SPECS: BlockSpec[] = [
  // Motion
  s('motion_movesteps', 'move', N('STEPS')),
  s('motion_turnright', 'turn_right', N('DEGREES')),
  s('motion_turnleft', 'turn_left', N('DEGREES')),
  s('motion_goto', 'go_to', M('TO', 'motion_goto_menu', 'TO', '_random_')),
  s('motion_gotoxy', 'go_to_xy', N('X'), N('Y')),
  s('motion_glideto', 'glide_to', N('SECS'), M('TO', 'motion_glideto_menu', 'TO', '_random_')),
  s('motion_glidesecstoxy', 'glide_to_xy', N('SECS'), N('X'), N('Y')),
  s('motion_pointindirection', 'point_in_direction', A('DIRECTION')),
  s('motion_pointtowards', 'point_towards', M('TOWARDS', 'motion_pointtowards_menu', 'TOWARDS', '_mouse_')),
  s('motion_changexby', 'change_x_by', N('DX')),
  s('motion_setx', 'set_x', N('X')),
  s('motion_changeyby', 'change_y_by', N('DY')),
  s('motion_sety', 'set_y', N('Y')),
  s('motion_ifonedgebounce', 'if_on_edge_bounce'),
  s('motion_setrotationstyle', 'set_rotation_style', F('STYLE')),
  r('motion_xposition', 'x_position'),
  r('motion_yposition', 'y_position'),
  r('motion_direction', 'direction'),
  // Looks
  s('looks_sayforsecs', 'say_for_secs', T('MESSAGE'), N('SECS')),
  s('looks_say', 'say', T('MESSAGE')),
  s('looks_thinkforsecs', 'think_for_secs', T('MESSAGE'), N('SECS')),
  s('looks_think', 'think', T('MESSAGE')),
  s('looks_switchcostumeto', 'switch_costume_to', M('COSTUME', 'looks_costume', 'COSTUME', 'costume1')),
  s('looks_nextcostume', 'next_costume'),
  s('looks_switchbackdropto', 'switch_backdrop_to', M('BACKDROP', 'looks_backdrops', 'BACKDROP', 'backdrop1')),
  s(
    'looks_switchbackdroptoandwait',
    'switch_backdrop_to_and_wait',
    M('BACKDROP', 'looks_backdrops', 'BACKDROP', 'backdrop1'),
  ),
  s('looks_nextbackdrop', 'next_backdrop'),
  s('looks_changesizeby', 'change_size_by', N('CHANGE')),
  s('looks_setsizeto', 'set_size_to', N('SIZE')),
  s('looks_changeeffectby', 'change_effect_by', F('EFFECT'), N('CHANGE')),
  s('looks_seteffectto', 'set_effect_to', F('EFFECT'), N('VALUE')),
  s('looks_cleargraphiceffects', 'clear_graphic_effects'),
  s('looks_show', 'show'),
  s('looks_hide', 'hide'),
  s('looks_gotofrontback', 'go_to_layer', F('FRONT_BACK')),
  s('looks_goforwardbackwardlayers', 'go_layers', F('FORWARD_BACKWARD'), I('NUM')),
  r('looks_costumenumbername', 'costume', F('NUMBER_NAME')),
  r('looks_backdropnumbername', 'backdrop', F('NUMBER_NAME')),
  r('looks_size', 'size'),
  // Sound
  s('sound_playuntildone', 'play_sound_until_done', M('SOUND_MENU', 'sound_sounds_menu', 'SOUND_MENU', '')),
  s('sound_play', 'start_sound', M('SOUND_MENU', 'sound_sounds_menu', 'SOUND_MENU', '')),
  s('sound_stopallsounds', 'stop_all_sounds'),
  s('sound_changeeffectby', 'change_sound_effect_by', F('EFFECT'), N('VALUE')),
  s('sound_seteffectto', 'set_sound_effect_to', F('EFFECT'), N('VALUE')),
  s('sound_cleareffects', 'clear_sound_effects'),
  s('sound_changevolumeby', 'change_volume_by', N('VOLUME')),
  s('sound_setvolumeto', 'set_volume_to', N('VOLUME')),
  r('sound_volume', 'volume'),
  // Events
  h('event_whenflagclicked', 'flag_clicked'),
  h('event_whenkeypressed', 'key_pressed', F('KEY_OPTION')),
  h('event_whenthisspriteclicked', 'this_sprite_clicked'),
  h('event_whenstageclicked', 'stage_clicked'),
  h('event_whenbackdropswitchesto', 'backdrop_switches_to', F('BACKDROP')),
  h('event_whengreaterthan', 'greater_than', F('WHENGREATERTHANMENU'), N('VALUE')),
  h('event_whenbroadcastreceived', 'i_receive', { broadcastField: 'BROADCAST_OPTION' }),
  s('event_broadcast', 'broadcast', { broadcastInput: 'BROADCAST_INPUT' }),
  s('event_broadcastandwait', 'broadcast_and_wait', { broadcastInput: 'BROADCAST_INPUT' }),
  // Control (if/else and loops have their own syntax)
  s('control_wait', 'wait', P('DURATION')),
  s('control_wait_until', 'wait_until', B('CONDITION')),
  c('control_stop', 'stop', F('STOP_OPTION')),
  h('control_start_as_clone', 'i_start_as_a_clone'),
  s(
    'control_create_clone_of',
    'create_clone_of',
    M('CLONE_OPTION', 'control_create_clone_of_menu', 'CLONE_OPTION', '_myself_'),
  ),
  c('control_delete_this_clone', 'delete_this_clone'),
  // Sensing
  b(
    'sensing_touchingobject',
    'touching',
    M('TOUCHINGOBJECTMENU', 'sensing_touchingobjectmenu', 'TOUCHINGOBJECTMENU', '_mouse_'),
  ),
  b('sensing_touchingcolor', 'touching_color', C('COLOR')),
  b('sensing_coloristouchingcolor', 'color_touching_color', C('COLOR'), C('COLOR2')),
  r('sensing_distanceto', 'distance_to', M('DISTANCETOMENU', 'sensing_distancetomenu', 'DISTANCETOMENU', '_mouse_')),
  s('sensing_askandwait', 'ask_and_wait', T('QUESTION')),
  r('sensing_answer', 'answer'),
  b('sensing_keypressed', 'key_pressed', M('KEY_OPTION', 'sensing_keyoptions', 'KEY_OPTION', 'space')),
  b('sensing_mousedown', 'mouse_down'),
  r('sensing_mousex', 'mouse_x'),
  r('sensing_mousey', 'mouse_y'),
  s('sensing_setdragmode', 'set_drag_mode', F('DRAG_MODE')),
  r('sensing_loudness', 'loudness'),
  r('sensing_timer', 'timer'),
  s('sensing_resettimer', 'reset_timer'),
  r('sensing_of', 'property_of', F('PROPERTY'), M('OBJECT', 'sensing_of_object_menu', 'OBJECT', '_stage_')),
  r('sensing_current', 'current', F('CURRENTMENU')),
  r('sensing_dayssince2000', 'days_since_2000'),
  r('sensing_username', 'username'),
  // Variables and lists (setting and changing variables have their own syntax)
  s('data_showvariable', 'show_variable', VARIABLE),
  s('data_hidevariable', 'hide_variable', VARIABLE),
  s('data_addtolist', 'add_to_list', LIST, T('ITEM')),
  s('data_deleteoflist', 'delete_of_list', LIST, I('INDEX')),
  s('data_deletealloflist', 'delete_all_of_list', LIST),
  s('data_insertatlist', 'insert_at_list', LIST, I('INDEX'), T('ITEM')),
  s('data_replaceitemoflist', 'replace_item_of_list', LIST, I('INDEX'), T('ITEM')),
  r('data_itemoflist', 'item_of_list', LIST, I('INDEX')),
  r('data_itemnumoflist', 'item_number_of_list', LIST, T('ITEM')),
  r('data_lengthoflist', 'length_of_list', LIST),
  b('data_listcontainsitem', 'list_contains', LIST, T('ITEM')),
  s('data_showlist', 'show_list', LIST),
  s('data_hidelist', 'hide_list', LIST),
]

const byOpcode = new Map(BLOCK_SPECS.map((spec) => [spec.opcode, spec]))
const hatsByName = new Map(BLOCK_SPECS.filter((spec) => spec.shape === 'hat').map((spec) => [spec.name, spec]))
const othersByName = new Map(BLOCK_SPECS.filter((spec) => spec.shape !== 'hat').map((spec) => [spec.name, spec]))

export const specForOpcode = (opcode: string): BlockSpec | undefined => byOpcode.get(opcode)
export const hatSpec = (name: string): BlockSpec | undefined => hatsByName.get(name)
export const blockSpec = (name: string): BlockSpec | undefined => othersByName.get(name)

/** Statement for blocks with no text form: `scratch_block('<json>')`. */
export const RAW_STATEMENT = 'scratch_block'
/** Reporter for blocks with no text form: `scratch_value('<json>')`. */
export const RAW_REPORTER = 'scratch_value'
/** Hat for hats with no text form: `when scratch_hat('<json>')`. */
export const RAW_HAT = 'scratch_hat'

export const snakeToCamel = (name: string): string =>
  name.replace(/_([\p{L}\p{N}])/gu, (_, letter: string) => letter.toUpperCase())

export const camelToSnake = (name: string): string =>
  name.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, (_, before: string, upper: string) => `${before}_${upper.toLowerCase()}`)
