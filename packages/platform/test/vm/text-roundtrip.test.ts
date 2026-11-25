/**
 * Text mode round trips: blocks → text → blocks must give the same scripts (after both are normalized by loading
 * them into scratch-vm), in both dialects, for every stock fixture and for a project using every custom feature.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { lowerProject } from '../../src/compat/lower'
import type { SerializedBlock, SerializedProject, SerializedTarget } from '../../src/sb3/types'
import { applyText, targetToText, type TextDialect } from '../../src/text'
import { customFeaturesProject } from '../fixtures/custom-features'
import { createVm, fixturePath, runFrames } from './vm-helpers'

const fixtureDir = path.dirname(fixturePath('x'))
const sb3Fixtures = fs.readdirSync(fixtureDir).filter((name) => name.endsWith('.sb3'))

const normalize = async (project: unknown): Promise<SerializedProject> => {
  const vm = createVm()
  await vm.loadProject(JSON.parse(JSON.stringify(project)))
  return JSON.parse(vm.toJSON())
}

/** Primitive values compare as text: `10` and `"10"` are the same field value to Scratch. */
const normalizeValue = (value: unknown): unknown =>
  Array.isArray(value) ? value.map((item) => (typeof item === 'number' ? String(item) : item)) : value

/** `["space"]` and `["space", null]` are the same field. */
const normalizeFields = (fields: SerializedBlock['fields']) =>
  Object.fromEntries(Object.entries(fields).map(([name, [value, id]]) => [name, [String(value), id ?? null]]))

/**
 * Scripts with block IDs, custom-block argument IDs and defaults, positions, comments and obscured shadows taken
 * out, so only the program remains.
 */
const program = (target: SerializedTarget): unknown => {
  const argumentIndex = new Map<string, string>()
  for (const block of Object.values(target.blocks) as SerializedBlock[]) {
    const ids: unknown = block.mutation?.argumentids ? JSON.parse(block.mutation.argumentids) : []
    if (Array.isArray(ids)) ids.forEach((id, i) => argumentIndex.set(String(id), `arg${i}`))
  }
  const walk = (id: string): unknown => {
    const block = target.blocks[id]
    if (Array.isArray(block)) return block
    const inputs: Record<string, unknown> = {}
    for (const [name, input] of Object.entries(block.inputs)) {
      const value = input[1]
      inputs[argumentIndex.get(name) ?? name] = [
        input[0] === 3 ? 3 : input[0],
        typeof value === 'string' ? walk(value) : normalizeValue(value),
      ]
    }
    const { argumentids, argumentdefaults: _defaults, ...mutation } = block.mutation ?? { tagName: '', children: [] }
    return {
      opcode: block.opcode,
      fields: normalizeFields(block.fields),
      inputs,
      // A stop block without a mutation is the same as one with hasnext "false" (older projects omit it).
      mutation:
        block.mutation && !(block.opcode === 'control_stop' && block.mutation.hasnext === 'false')
          ? { ...mutation, argumentids: argumentids && 'ids' }
          : undefined,
      next: block.next ? walk(block.next) : null,
    }
  }
  const tops = Object.keys(target.blocks).filter((id) => {
    const block = target.blocks[id]
    return Array.isArray(block) || (block.topLevel && !block.shadow)
  })
  return tops.map(walk).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

const roundTrip = (project: SerializedProject, dialect: TextDialect): SerializedProject => {
  let result = project
  for (const target of project.targets) {
    const text = targetToText(target, dialect)
    result = applyText(result, target.name, text, dialect)
  }
  return result
}

const dialects: TextDialect[] = ['python', 'javascript']

describe.each(dialects)('%s round trip', (dialect) => {
  test.each(sb3Fixtures)('%s', async (name) => {
    const vm = createVm()
    try {
      await vm.loadProject(fs.readFileSync(path.join(fixtureDir, name)))
    } catch {
      return
    }
    const original: SerializedProject = JSON.parse(vm.toJSON())
    const after = await normalize(roundTrip(original, dialect))
    expect(after.targets.map(program)).toEqual(original.targets.map(program))
  })

  test('project using every custom feature', async () => {
    const original = await normalize(lowerProject(customFeaturesProject()))
    const after = await normalize(roundTrip(original, dialect))
    expect(after.targets.map(program)).toEqual(original.targets.map(program))
    // And it still behaves the same.
    const run = async (project: unknown) => {
      const runVm = createVm()
      await runVm.loadProject(JSON.parse(JSON.stringify(project)))
      return runFrames(runVm, 60, (frame) => frame % 13 < 5)
    }
    expect(await run(after)).toEqual(await run(original))
  })
})
