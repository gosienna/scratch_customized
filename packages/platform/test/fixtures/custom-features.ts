/**
 * A project in Custom-mode form that uses every editor-only feature: expressions (with sprite, stage,
 * parameter and block-local variables), conditions, and mouse up.
 */
import type { SerializedProject } from '../../src/sb3/types'
import { block, project, target } from '../helpers'

const costume = {
  assetId: 'cd21514d0531fdffb22204e0ec5ed84a',
  name: 'costume1',
  md5ext: 'cd21514d0531fdffb22204e0ec5ed84a.svg',
  dataFormat: 'svg',
  rotationCenterX: 0,
  rotationCenterY: 0,
}

const proto = (proccode: string) => ({
  tagName: 'mutation',
  children: [],
  proccode,
  argumentids: '["argN","argB"]',
  argumentnames: '["n","fast"]',
  argumentdefaults: '["",false]',
  warp: 'false',
})

export const customFeaturesProject = (): SerializedProject => {
  const stage = target('Stage', true, {
    variables: { gScore: ['score', 0], gSpeed: ['speed', 100] },
    costumes: [costume],
  })
  const sprite = target('Sprite1', false, {
    costumes: [costume],
    x: 0,
    y: 0,
    size: 100,
    direction: 90,
    draggable: false,
    rotationStyle: 'all around',
    visible: true,
    variables: {
      sCount: ['count', 0],
      sSpeed: ['speed', 3],
      sTmp: ['step it high::tmp', 1],
      sOther: ['other::tmp', 50],
    },
    blocks: {
      // when flag clicked
      hat: block('event_whenflagclicked', { topLevel: true, x: 0, y: 0, next: 'setCount' }),
      setCount: block('data_setvariableto', {
        parent: 'hat',
        next: 'forever',
        inputs: { VALUE: [1, [10, '0']] },
        fields: { VARIABLE: ['count', 'sCount'] },
      }),
      forever: block('control_forever', { parent: 'setCount', inputs: { SUBSTACK: [2, 'if1'] } }),
      // if <speed > 2 and count < 100> then change count by ((speed + 1) * 2 mod 7 + random(1, 3))
      if1: block('control_if', {
        parent: 'forever',
        next: 'if2',
        inputs: { CONDITION: [2, 'cond1'], SUBSTACK: [2, 'change'] },
      }),
      cond1: block('operator_condition', { parent: 'if1', fields: { EXPR: ['speed > 2 and count < 100', null] } }),
      change: block('data_changevariableby', {
        parent: 'if1',
        inputs: { VALUE: [3, 'expr1', [4, '1']] },
        fields: { VARIABLE: ['count', 'sCount'] },
      }),
      expr1: block('operator_expression', {
        parent: 'change',
        fields: { EXPR: ['(speed + 1) * 2 mod 7 + random(1, 3)', null] },
      }),
      // if <mouse up?> then step it high (count / 3) <mouse up?>
      if2: block('control_if', {
        parent: 'if1',
        next: 'score',
        inputs: { CONDITION: [2, 'up1'], SUBSTACK: [2, 'call'] },
      }),
      up1: block('sensing_mouseup', { parent: 'if2' }),
      call: block('procedures_call', {
        parent: 'if2',
        inputs: { argN: [3, 'expr2', [10, '']], argB: [2, 'up2'] },
        mutation: { ...proto('step it %n high %b'), argumentnames: undefined, argumentdefaults: undefined },
      }),
      expr2: block('operator_expression', { parent: 'call', fields: { EXPR: ['count / 3', null] } }),
      up2: block('sensing_mouseup', { parent: 'call' }),
      // set score (a stage variable, not hidden by a sprite variable) to join(count, " pts")
      score: block('data_setvariableto', {
        parent: 'if2',
        inputs: { VALUE: [3, 'expr3', [10, '']] },
        fields: { VARIABLE: ['score', 'gScore'] },
      }),
      expr3: block('operator_expression', {
        parent: 'score',
        fields: { EXPR: ['join(round(count * 1.5), " pts")', null] },
      }),

      // define step it (n) high <fast>
      def: block('procedures_definition', {
        topLevel: true,
        x: 400,
        y: 0,
        inputs: { custom_block: [1, 'proto'] },
        next: 'setTmp',
      }),
      proto: block('procedures_prototype', {
        parent: 'def',
        shadow: true,
        inputs: { argN: [1, 'argNReporter'], argB: [1, 'argBReporter'] },
        mutation: proto('step it %n high %b'),
      }),
      argNReporter: block('argument_reporter_string_number', {
        parent: 'proto',
        shadow: true,
        fields: { VALUE: ['n', null] },
      }),
      argBReporter: block('argument_reporter_boolean', {
        parent: 'proto',
        shadow: true,
        fields: { VALUE: ['fast', null] },
      }),
      // set [step it high::tmp] to (n * 2 + tmp)     — "tmp" is the block-local variable, not other::tmp
      setTmp: block('data_setvariableto', {
        parent: 'def',
        next: 'changeX',
        inputs: { VALUE: [3, 'expr4', [10, '0']] },
        fields: { VARIABLE: ['step it high::tmp', 'sTmp'] },
      }),
      expr4: block('operator_expression', { parent: 'setTmp', fields: { EXPR: ['n * 2 + tmp', null] } }),
      // change x by (tmp mod 7 - 2)
      changeX: block('motion_changexby', {
        parent: 'setTmp',
        next: 'ifFast',
        inputs: { DX: [3, 'expr5', [4, '10']] },
      }),
      expr5: block('operator_expression', { parent: 'changeX', fields: { EXPR: ['tmp mod 7 - 2', null] } }),
      // if <fast or n > 10> then turn right (sqrt(abs(n)) degrees
      ifFast: block('control_if', { parent: 'changeX', inputs: { CONDITION: [2, 'cond2'], SUBSTACK: [2, 'turn'] } }),
      cond2: block('operator_condition', { parent: 'ifFast', fields: { EXPR: ['fast or n > 10', null] } }),
      turn: block('motion_turnright', { parent: 'ifFast', inputs: { DEGREES: [3, 'expr6', [4, '15']] } }),
      expr6: block('operator_expression', {
        parent: 'turn',
        fields: { EXPR: ['sqrt(abs(n)) + [other::tmp] / 50', null] },
      }),
    },
  })
  return project(sprite, stage)
}
