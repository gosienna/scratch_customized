/**
 * Level 3: every kind of file this editor saves is opened in the UNMODIFIED official Scratch GUI (built by
 * scripts/build-official-gui.sh) with File > Load from your computer. It must load without errors, show every
 * script, and run; then the official GUI saves it and this editor must recognize its custom features again.
 *
 * Run: npm run build:official-gui && npm run write-outputs && npm run test:gui
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Page, test } from '@playwright/test'
import { raiseProject } from '../../packages/platform/src/compat/raise'
import { CUSTOM_OPCODES } from '../../packages/platform/src/compat/opcodes'
import type { SerializedProject } from '../../packages/platform/src/sb3/types'
import JSZip from 'jszip'

const here = path.dirname(fileURLToPath(import.meta.url))

const outputDir = path.resolve(here, '.outputs')
const files = fs.existsSync(outputDir) ? fs.readdirSync(outputDir).filter((file) => file.endsWith('.sb3')) : []

interface Expectation {
  name: string
  targets: { name: string; scripts: number }[]
  customFeatures: boolean
}

/** The official GUI's VM, found through React's internal fiber tree (the GUI does not expose it). */
const projectState = (page: Page) =>
  page.evaluate(() => {
    const element = document.querySelector('[class*="gui_body-wrapper"]')
    if (!element) return null
    const key = Object.keys(element).find((k) => k.startsWith('__reactFiber'))
    let fiber = key ? (element as unknown as Record<string, { memoizedProps?: { vm?: unknown }; return: unknown }>)[key] : undefined
    let vm: { runtime: { targets: { isOriginal: boolean; getName: () => string; blocks: { getScripts: () => string[] } }[] } } | undefined
    while (fiber && !vm) {
      const candidate = fiber.memoizedProps?.vm as typeof vm
      if (candidate?.runtime) vm = candidate
      fiber = fiber.return as typeof fiber
    }
    if (!vm) return null
    ;(window as unknown as { officialVm: unknown }).officialVm = vm
    return vm.runtime.targets
      .filter((target) => target.isOriginal)
      .map((target) => ({ name: target.getName(), scripts: target.blocks.getScripts().length }))
  })

test.skip(files.length === 0, 'No outputs: run npm run write-outputs first')

for (const file of files) {
  const expectation = JSON.parse(fs.readFileSync(path.join(outputDir, file.replace(/\.sb3$/, '.expect.json')), 'utf8')) as Expectation

  test(expectation.name, async ({ page }) => {
    const dialogs: string[] = []
    const pageErrors: string[] = []
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message())
      void dialog.dismiss()
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await page.goto('index.html')
    await page.getByRole('button', { name: /File menu/i }).click()
    const chooser = page.waitForEvent('filechooser')
    await page.getByText('Load from your computer').click()
    await (await chooser).setFiles(path.join(outputDir, file))

    // Loaded when the official VM holds the expected sprites with every script.
    await expect.poll(() => projectState(page), { timeout: 30_000 }).toEqual(expectation.targets)
    expect(dialogs, 'no "could not load project" alert').toEqual([])

    // Run it for two seconds.
    await page.getByRole('button', { name: /^Start project|Go$/ }).first().click()
    await page.waitForTimeout(2000)
    expect(pageErrors, 'no errors while loading or running').toEqual([])

    // Save from the official GUI; this editor must see its custom features again.
    const saved = await page.evaluate(async () => {
      const vm = (window as unknown as { officialVm: { saveProjectSb3: () => Promise<Blob> } }).officialVm
      const blob = await vm.saveProjectSb3()
      return Array.from(new Uint8Array(await blob.arrayBuffer()))
    })
    const zip = await JSZip.loadAsync(Uint8Array.from(saved))
    const resaved = JSON.parse(await zip.file('project.json')!.async('string')) as SerializedProject
    const raisedOpcodes = raiseProject(resaved).targets.flatMap((target) =>
      Object.values(target.blocks).flatMap((block) => (Array.isArray(block) ? [] : [block.opcode])),
    )
    expect(raisedOpcodes.some((opcode) => CUSTOM_OPCODES.has(opcode))).toBe(expectation.customFeatures)
  })
}
