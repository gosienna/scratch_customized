import { describe, expect, test } from 'vitest'
import type { SerializedBlock, SerializedProject } from '../src/sb3/types'
import { applyText, targetToText, TextSyntaxError } from '../src/text'
import { project, target } from './helpers'

const emptyProject = (): SerializedProject =>
  project(
    target('Sprite1', false, { variables: { v1: ['score', 0] }, lists: { l1: ['items', []] } }),
    target('Stage', true, { variables: { g1: ['level', 1] }, broadcasts: { b1: 'start' } }),
  )

const blocksOf = (result: SerializedProject) => Object.values(result.targets[1].blocks) as SerializedBlock[]
const opcodes = (result: SerializedProject) => blocksOf(result).map((block) => block.opcode)
const findBlock = (result: SerializedProject, opcode: string): SerializedBlock => {
  const found = blocksOf(result).find((block) => block.opcode === opcode)
  if (!found) throw new Error(`no ${opcode} block`)
  return found
}

describe('Python-style text', () => {
  test('hand-written code becomes blocks', () => {
    const text = `
# A comment line
when flag_clicked:
    score = 0            # reset
    lives = 3
    for _ in range(10):
        score += level * 2
        if key_pressed("space") and score > 5:
            say("Jump!")
        elif mouse_down():
            pass
        else:
            score -= 1
    while not touching("_edge_"):
        move(5)
    add_to_list(items, score)
    broadcast("game over")

when i_receive("start"):
    go_to_xy(0, 0)
`
    const result = applyText(emptyProject(), 'Sprite1', text, 'python')
    const sprite = result.targets[1]
    expect(Object.values(sprite.variables).map(([name]) => name)).toEqual(['score', 'lives'])
    expect(Object.values(result.targets[0].broadcasts)).toEqual(['start', 'game over'])
    expect(opcodes(result)).toEqual(
      expect.arrayContaining([
        'event_whenflagclicked',
        'control_repeat',
        'control_if_else',
        'sensing_keypressed',
        'sensing_keyoptions',
        'control_repeat_until',
        'sensing_touchingobject',
        'data_addtolist',
        'event_broadcast',
        'event_whenbroadcastreceived',
      ]),
    )
    const receive = findBlock(result, 'event_whenbroadcastreceived')
    expect(receive.fields.BROADCAST_OPTION).toEqual(['start', 'b1'])
    const decrement = blocksOf(result).filter((block) => block.opcode === 'data_changevariableby')[1]
    expect(decrement.inputs.VALUE).toEqual([1, [4, '-1']])
  })

  test('text → blocks → text is stable', () => {
    const text = `when flag_clicked:
    score = 0
    while True:
        if score > 10 or not mouse_down():
            say(join("Score: ", score))
        else:
            change_x_by(-5)
        score += 1
`
    const once = applyText(emptyProject(), 'Sprite1', text, 'python')
    const printed = targetToText(once.targets[1], 'python')
    expect(printed).toBe(`# @pos(0, 0)\n${text}`)
    const twice = applyText(once, 'Sprite1', printed, 'python')
    expect(targetToText(twice.targets[1], 'python')).toBe(printed)
  })

  test('custom blocks with parameters and block-local variables', () => {
    const text = `@block("jump %n high")
def jump(height):
    step = height / 2
    change_y_by(step)

when flag_clicked:
    jump(10)
`
    const result = applyText(emptyProject(), 'Sprite1', text, 'python')
    const variableNames = Object.values(result.targets[1].variables).map(([name]) => name)
    // "step" is assigned inside the definition but no local exists, so it becomes a sprite variable.
    expect(variableNames).toContain('step')
    const call = findBlock(result, 'procedures_call')
    expect(call.mutation?.proccode).toBe('jump %n high')
  })

  test.each([
    ['when flag_clicked:\n    fly(3)\n', 'Line 2: Unknown block "fly"'],
    ['when flag_clicked:\n    move(1, 2)\n', 'Line 2: move() takes 1 input, not 2'],
    ['when flag_clicked:\n    say(nope)\n', 'Line 2: Unknown variable "nope"'],
    ['when flag_clicked:\n    if move(3):\n        pass\n', 'Line 2: move() is a statement'],
    ['when flag_clicked:\nmove(3)\n', 'Line 1: Expected an indented block'],
    ['when flag_clicked:\n    move((1 + 2)\n', 'Line 2: Missing closing )'],
    ['when party_starts:\n    pass\n', 'Line 1: Unknown event "party_starts"'],
  ])('reports mistakes with line numbers: %j', (text, message) => {
    expect(() => applyText(emptyProject(), 'Sprite1', text, 'python')).toThrow(TextSyntaxError)
    expect(() => applyText(emptyProject(), 'Sprite1', text, 'python')).toThrow(message)
  })
})

describe('JavaScript-style text', () => {
  test('hand-written code becomes blocks', () => {
    const text = `when (flagClicked) {
  score = 0;
  repeat (10) {
    if (keyPressed("space") && !(score > 5)) {
      say("Jump!");
    } else if (mouseDown()) {
      changeXBy(1);
    } else {
      score -= 2;
    }
  }
  while (!touching("_edge_")) {
    move(5);
  }
}
`
    const result = applyText(emptyProject(), 'Sprite1', text, 'javascript')
    expect(opcodes(result)).toEqual(
      expect.arrayContaining([
        'control_repeat',
        'control_if_else',
        'operator_not',
        'control_repeat_until',
        'motion_changexby',
      ]),
    )
    const printed = targetToText(result.targets[1], 'javascript')
    expect(targetToText(applyText(result, 'Sprite1', printed, 'javascript').targets[1], 'javascript')).toBe(printed)
  })

  test('! binds tightly, as in JavaScript', () => {
    const result = applyText(
      emptyProject(),
      'Sprite1',
      'when (flagClicked) {\n  if (!mouseDown() && score > 1) {\n  }\n}\n',
      'javascript',
    )
    const and = findBlock(result, 'operator_and')
    expect((result.targets[1].blocks[and.inputs.OPERAND1[1] as string] as SerializedBlock).opcode).toBe(
      'operator_not',
    )
  })

  test('reports a missing brace', () => {
    expect(() => applyText(emptyProject(), 'Sprite1', 'when (flagClicked) {\n  move(1);\n', 'javascript')).toThrow(
      'Line 1: Missing "}"',
    )
  })
})
