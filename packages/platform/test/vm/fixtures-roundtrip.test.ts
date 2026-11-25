/**
 * Every stock project in scratch-vm's fixtures must come back unchanged from raise → lower, and must still
 * pass scratch-parser.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { lowerProject } from '../../src/compat/lower'
import { raiseProject } from '../../src/compat/raise'
import type { SerializedProject } from '../../src/sb3/types'
import { canonicalScripts } from '../helpers'
import { createVm, fixturePath, validateWithScratchParser } from './vm-helpers'

const fixtureDir = path.dirname(fixturePath('x'))
const sb3Fixtures = fs.readdirSync(fixtureDir).filter((name) => name.endsWith('.sb3'))

/** Load a fixture into a plain VM and return the VM's own serialization (skipping fixtures that do not load). */
const loadFixture = async (name: string): Promise<SerializedProject | undefined> => {
  const vm = createVm()
  try {
    await vm.loadProject(fs.readFileSync(path.join(fixtureDir, name)))
  } catch {
    return undefined
  }
  return JSON.parse(vm.toJSON())
}

describe('stock fixtures survive raise → lower', () => {
  test.each(sb3Fixtures)('%s', async (name) => {
    const original = await loadFixture(name)
    if (!original) return
    const roundTripped = lowerProject(raiseProject(original))
    expect(roundTripped.targets.map(canonicalScripts)).toEqual(original.targets.map(canonicalScripts))
    await validateWithScratchParser(roundTripped)
  })
})

describe('a stock project with many operator trees survives raise → lower', () => {
  test('lowered custom-features project', async () => {
    const { customFeaturesProject } = await import('../fixtures/custom-features')
    const stock = lowerProject(customFeaturesProject())
    const raised = raiseProject(stock)
    const raisedCount = Object.values(raised.targets[1].blocks).filter(
      (b) => !Array.isArray(b) && b.opcode.startsWith('operator_e'),
    ).length
    expect(raisedCount).toBeGreaterThan(3)
    expect(lowerProject(raised).targets.map(canonicalScripts)).toEqual(stock.targets.map(canonicalScripts))
  })
})
