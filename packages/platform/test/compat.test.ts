import { describe, expect, test } from 'vitest'
import { lowerProject, CompatibilityError } from '../src/compat/lower'
import { raiseProject } from '../src/compat/raise'
import type { SerializedBlock, SerializedTarget } from '../src/sb3/types'
import { block, canonicalScripts, project, target } from './helpers'

const stage = () => target('Stage', true, { variables: { gScore: ['score', 0], gSpeed: ['speed', 1] } })

/** A sprite whose "move" block holds an expression in its STEPS slot. */
const spriteWithExpression = (source: string, opcode = 'operator_expression') =>
  target('Sprite1', false, {
    variables: { sSpeed: ['speed', 5] },
    blocks: {
      hat: block('event_whenflagclicked', { topLevel: true, x: 0, y: 0, next: 'move' }),
      move: block('motion_movesteps', { parent: 'hat', inputs: { STEPS: [3, 'expr', [4, '10']] } }),
      expr: block(opcode, { parent: 'move', fields: { EXPR: [source, null] } }),
    },
  })

const lowerSprite = (sprite: SerializedTarget, stageTarget = stage()) =>
  lowerProject(project(sprite, stageTarget)).targets[1]

describe('lowerProject: expressions', () => {
  test('lowers to operator blocks, resolving sprite variables before stage variables', () => {
    const lowered = lowerSprite(spriteWithExpression('(speed + score) / 2'))
    const move = lowered.blocks.move as SerializedBlock
    expect(move.inputs.STEPS).toEqual([3, 'expr', [4, '10']])
    const divide = lowered.blocks.expr as SerializedBlock
    expect(divide.opcode).toBe('operator_divide')
    expect(divide.parent).toBe('move')
    expect(divide.inputs.NUM2).toEqual([1, [4, '2']])
    const add = lowered.blocks[divide.inputs.NUM1[1] as string] as SerializedBlock
    expect(add).toMatchObject({ opcode: 'operator_add', parent: 'expr' })
    expect(add.inputs.NUM1).toEqual([3, [12, 'speed', 'sSpeed'], [4, '']])
    expect(add.inputs.NUM2).toEqual([3, [12, 'score', 'gScore'], [4, '']])
  })

  test('a literal goes straight into the slot field', () => {
    const lowered = lowerSprite(spriteWithExpression('42'))
    expect((lowered.blocks.move as SerializedBlock).inputs.STEPS).toEqual([1, [4, '42']])
    expect(lowered.blocks.expr).toBeUndefined()
  })

  test('a single variable becomes a variable reporter', () => {
    const lowered = lowerSprite(spriteWithExpression('score'))
    expect((lowered.blocks.move as SerializedBlock).inputs.STEPS).toEqual([3, [12, 'score', 'gScore'], [4, '10']])
  })

  test('text in a number slot is kept via join', () => {
    const lowered = lowerSprite(spriteWithExpression('"abc"'))
    const join = lowered.blocks.expr as SerializedBlock
    expect(join.opcode).toBe('operator_join')
    expect(join.inputs.STRING1).toEqual([1, [10, 'abc']])
  })

  test('invalid text is saved as join(text, "") so nothing is lost', () => {
    const lowered = lowerSprite(spriteWithExpression('(a +'))
    expect((lowered.blocks.expr as SerializedBlock).inputs.STRING1).toEqual([1, [10, '(a +']])
  })

  test('unknown names are saved as 0', () => {
    const lowered = lowerSprite(spriteWithExpression('nothing'))
    expect((lowered.blocks.move as SerializedBlock).inputs.STEPS).toEqual([1, [4, '0']])
  })

  test('conditions in boolean slots; invalid conditions become empty (false)', () => {
    const condition = (source: string) =>
      target('Sprite1', false, {
        variables: { sSpeed: ['speed', 5] },
        blocks: {
          if: block('control_if', { topLevel: true, x: 0, y: 0, inputs: { CONDITION: [2, 'cond'] } }),
          cond: block('operator_condition', { parent: 'if', fields: { EXPR: [source, null] } }),
        },
      })
    const good = lowerSprite(condition('speed > 3 and not speed = 10'))
    expect((good.blocks.if as SerializedBlock).inputs.CONDITION).toEqual([2, 'cond'])
    expect((good.blocks.cond as SerializedBlock).opcode).toBe('operator_and')
    const bad = lowerSprite(condition('speed + 1'))
    expect((bad.blocks.if as SerializedBlock).inputs.CONDITION).toBeUndefined()
  })

  test('custom block params and block-local variables', () => {
    const sprite = target('Sprite1', false, {
      variables: { local: ['jump high::height', 0], sSpeed: ['speed', 5] },
      blocks: {
        def: block('procedures_definition', {
          topLevel: true,
          x: 0,
          y: 0,
          inputs: { custom_block: [1, 'proto'] },
          next: 'change',
        }),
        proto: block('procedures_prototype', {
          parent: 'def',
          shadow: true,
          inputs: { argN: [1, 'argNReporter'], argB: [1, 'argBReporter'] },
          mutation: {
            tagName: 'mutation',
            children: [],
            proccode: 'jump %n high %b',
            argumentids: '["argN","argB"]',
            argumentnames: '["power","fast"]',
            argumentdefaults: '["",false]',
            warp: 'false',
          },
        }),
        argNReporter: block('argument_reporter_string_number', {
          parent: 'proto',
          shadow: true,
          fields: { VALUE: ['power', null] },
        }),
        argBReporter: block('argument_reporter_boolean', {
          parent: 'proto',
          shadow: true,
          fields: { VALUE: ['fast', null] },
        }),
        change: block('motion_changeyby', { parent: 'def', inputs: { DY: [3, 'expr', [4, '10']] } }),
        expr: block('operator_expression', { parent: 'change', fields: { EXPR: ['power * height', null] } }),
      },
    })
    const lowered = lowerSprite(sprite)
    const multiply = lowered.blocks.expr as SerializedBlock
    const param = lowered.blocks[multiply.inputs.NUM1[1] as string] as SerializedBlock
    expect(param).toMatchObject({ opcode: 'argument_reporter_string_number', fields: { VALUE: ['power', null] } })
    expect(multiply.inputs.NUM2).toEqual([3, [12, 'jump high::height', 'local'], [4, '']])
  })

  test('loose expressions on the workspace stay top-level', () => {
    const sprite = target('Sprite1', false, {
      blocks: { e: block('operator_expression', { topLevel: true, x: 5, y: 6, fields: { EXPR: ['1 + 2', null] } }) },
    })
    expect(lowerSprite(sprite).blocks.e).toMatchObject({ opcode: 'operator_add', topLevel: true, x: 5, y: 6 })
  })
})

describe('lowerProject: mouse up', () => {
  test('becomes not <mouse down?>', () => {
    const sprite = target('Sprite1', false, {
      blocks: {
        wait: block('control_wait_until', { topLevel: true, x: 0, y: 0, inputs: { CONDITION: [2, 'up'] } }),
        up: block('sensing_mouseup', { parent: 'wait' }),
      },
    })
    const lowered = lowerSprite(sprite)
    const not = lowered.blocks.up as SerializedBlock
    expect(not.opcode).toBe('operator_not')
    expect(lowered.blocks[not.inputs.OPERAND[1] as string]).toMatchObject({
      opcode: 'sensing_mousedown',
      parent: 'up',
    })
  })
})

describe('assertStockProject', () => {
  test('rejects unknown extensions', () => {
    const json = project(target('Sprite1', false))
    json.extensions = ['pen', 'myCustomExtension']
    expect(() => lowerProject(json)).toThrow(CompatibilityError)
  })
})

describe('raiseProject', () => {
  test('raise then lower gives back the same scripts', () => {
    const lowered = lowerProject(project(spriteWithExpression('(speed + score) / 2 - abs(speed)'), stage()))
    const raised = raiseProject(lowered)
    const expr = raised.targets[1].blocks.expr as SerializedBlock
    expect(expr.opcode).toBe('operator_expression')
    expect(expr.fields.EXPR).toEqual(['(speed + score) / 2 - abs(speed)', null])
    expect(canonicalScripts(lowerProject(raised).targets[1])).toEqual(canonicalScripts(lowered.targets[1]))
  })

  test('does not raise single operators, or when disabled', () => {
    const lowered = lowerProject(project(spriteWithExpression('speed + 1'), stage()))
    expect((raiseProject(lowered).targets[1].blocks.expr as SerializedBlock).opcode).toBe('operator_add')
    const twoOps = lowerProject(project(spriteWithExpression('speed + 1 + 2'), stage()))
    expect((raiseProject(twoOps, { expressions: false }).targets[1].blocks.expr as SerializedBlock).opcode).toBe(
      'operator_add',
    )
  })

  test('does not raise when a name would resolve to a different variable', () => {
    // The tree refers to the stage "speed", which the sprite's own "speed" hides.
    const sprite = spriteWithExpression('1')
    sprite.blocks.expr = block('operator_add', {
      parent: 'move',
      inputs: { NUM1: [3, [12, 'speed', 'gSpeed'], [4, '']], NUM2: [3, 'mul', [4, '']] },
    })
    sprite.blocks.mul = block('operator_multiply', {
      parent: 'expr',
      inputs: { NUM1: [1, [4, '2']], NUM2: [1, [4, '3']] },
    })
    const raised = raiseProject(project(sprite, stage())).targets[1]
    expect((raised.blocks.expr as SerializedBlock).opcode).toBe('operator_add')
  })

  test('raises the parts of a tree that have expression syntax', () => {
    const sprite = spriteWithExpression('1')
    sprite.blocks.expr = block('operator_add', {
      parent: 'move',
      inputs: { NUM1: [3, 'mx', [4, '']], NUM2: [3, 'mul', [4, '']] },
    })
    sprite.blocks.mx = block('sensing_mousex', { parent: 'expr' })
    sprite.blocks.mul = block('operator_multiply', {
      parent: 'expr',
      inputs: { NUM1: [1, [4, '2']], NUM2: [3, 'sub', [4, '']] },
    })
    sprite.blocks.sub = block('operator_subtract', {
      parent: 'mul',
      inputs: { NUM1: [1, [4, '5']], NUM2: [1, [4, '1']] },
    })
    const raised = raiseProject(project(sprite, stage())).targets[1]
    expect(raised.blocks.mul).toMatchObject({
      opcode: 'operator_expression',
      fields: { EXPR: ['2 * (5 - 1)', null] },
    })
    expect(raised.blocks.sub).toBeUndefined()
  })

  test('comparisons in boolean slots become conditions', () => {
    const sprite = target('Sprite1', false, {
      variables: { sSpeed: ['speed', 5] },
      blocks: {
        if: block('control_if', { topLevel: true, x: 0, y: 0, inputs: { CONDITION: [2, 'cond'] } }),
        cond: block('operator_condition', { parent: 'if', fields: { EXPR: ['speed > 3 and speed < 10', null] } }),
      },
    })
    const raised = raiseProject(lowerProject(project(sprite, stage()))).targets[1]
    expect(raised.blocks.cond).toMatchObject({
      opcode: 'operator_condition',
      fields: { EXPR: ['speed > 3 and speed < 10', null] },
    })
  })

  test('raises not <mouse down?> to mouse up', () => {
    const sprite = target('Sprite1', false, {
      blocks: {
        wait: block('control_wait_until', { topLevel: true, x: 0, y: 0, inputs: { CONDITION: [2, 'up'] } }),
        up: block('sensing_mouseup', { parent: 'wait' }),
      },
    })
    const raised = raiseProject(lowerProject(project(sprite))).targets[1]
    expect(Object.keys(raised.blocks).sort()).toEqual(['up', 'wait'])
    expect(raised.blocks.up).toMatchObject({ opcode: 'sensing_mouseup', inputs: {} })
  })
})
