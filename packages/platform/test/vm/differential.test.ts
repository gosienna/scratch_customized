/**
 * Differential execution: a Custom-mode project run with the editor-only primitives must behave exactly like
 * its lowered (stock) form run without them.
 */
import { describe, expect, test } from 'vitest'
import { lowerProject } from '../../src/compat/lower'
import { CUSTOM_OPCODES } from '../../src/compat/opcodes'
import { raiseProject } from '../../src/compat/raise'
import { installPrimitives } from '../../src/runtime/primitives'
import { isBlock } from '../../src/sb3/types'
import { customFeaturesProject } from '../fixtures/custom-features'
import { createVm, runFrames, validateWithScratchParser } from './vm-helpers'

const FRAMES = 120
// Mouse pressed in irregular bursts so both "mouse up" branches run.
const mouseDownAt = (frame: number) => frame % 17 < 6 || (frame > 60 && frame % 5 === 0)

const runCustom = async (json: unknown) => {
  const vm = createVm()
  installPrimitives(vm)
  await vm.loadProject(JSON.parse(JSON.stringify(json)))
  return runFrames(vm, FRAMES, mouseDownAt)
}

const runStock = async (json: unknown) => {
  const vm = createVm()
  await vm.loadProject(JSON.parse(JSON.stringify(json)))
  return runFrames(vm, FRAMES, mouseDownAt)
}

describe('custom features behave like their lowered form', () => {
  test('lowered project contains only stock blocks and passes scratch-parser', async () => {
    const lowered = lowerProject(customFeaturesProject())
    for (const target of lowered.targets) {
      for (const block of Object.values(target.blocks))
        if (isBlock(block)) expect(CUSTOM_OPCODES.has(block.opcode)).toBe(false)
    }
    await validateWithScratchParser(lowered)
  })

  test('frame-by-frame state matches', async () => {
    const custom = customFeaturesProject()
    const customStates = await runCustom(custom)
    const stockStates = await runStock(lowerProject(custom))
    // Sanity check that the program actually did something.
    expect(customStates[FRAMES - 1].Sprite1.variables.count).not.toBe(0)
    expect(customStates[FRAMES - 1].Sprite1.x).not.toBe(0)
    for (let frame = 0; frame < FRAMES; frame++)
      expect(customStates[frame], `frame ${frame}`).toEqual(stockStates[frame])
  })

  test('a project raised again after saving still behaves the same', async () => {
    const lowered = lowerProject(customFeaturesProject())
    const raisedStates = await runCustom(raiseProject(lowered))
    const stockStates = await runStock(lowered)
    expect(raisedStates).toEqual(stockStates)
  })

  test('the VM save hook lowers on save and raises on load', async () => {
    const { createProjectTransforms } = await import('../../src/compat/transforms')
    const vm = createVm()
    installPrimitives(vm)
    vm.setProjectTransforms(createProjectTransforms({ shouldRaise: () => true }))
    await vm.loadProject(JSON.parse(JSON.stringify(customFeaturesProject())))
    const saved = JSON.parse(vm.toJSON())
    await validateWithScratchParser(saved)
    const opcodes = saved.targets.flatMap((t: { blocks: object }) =>
      Object.values(t.blocks).map((b: { opcode?: string }) => b.opcode),
    )
    expect(opcodes).toContain('sensing_mousedown')
    expect(opcodes).not.toContain('sensing_mouseup')

    await vm.loadProject(saved)
    const sprite = vm.runtime.targets.find((t: { isStage: boolean }) => !t.isStage)
    const loadedOpcodes = Object.values(sprite.blocks._blocks).map((b) => (b as { opcode: string }).opcode)
    expect(loadedOpcodes).toContain('sensing_mouseup')
    expect(loadedOpcodes).toContain('operator_expression')
    expect(loadedOpcodes).toContain('operator_condition')
  })
})
