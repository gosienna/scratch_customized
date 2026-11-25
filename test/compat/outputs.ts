/** Every kind of file this editor writes, produced with the editor's own code (the fork VM and the platform). */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { lowerProject } from '../../packages/platform/src/compat/lower'
import { raiseProject } from '../../packages/platform/src/compat/raise'
import { createProjectTransforms } from '../../packages/platform/src/compat/transforms'
import { installPrimitives } from '../../packages/platform/src/runtime/primitives'
import type { SerializedProject } from '../../packages/platform/src/sb3/types'
import { applyText } from '../../packages/platform/src/text'
import { customFeaturesProject } from '../../packages/platform/test/fixtures/custom-features'
import { createVm as createForkVm } from '../../packages/platform/test/vm/vm-helpers'

const here = path.dirname(fileURLToPath(import.meta.url))

export interface Output {
  name: string
  project: SerializedProject
  /** Costume and sound files by md5ext, when they do not come from the default project. */
  assets?: Map<string, Uint8Array>
  /** True if the editor should show Custom-mode blocks again when it opens this file. */
  customFeatures: boolean
}

/** Save a Custom-mode project the way the editor does: through the fork VM's save hook. */
export const savedByEditor = async (customProject: SerializedProject): Promise<SerializedProject> => {
  const vm = createForkVm()
  installPrimitives(vm)
  vm.setProjectTransforms(createProjectTransforms({ shouldRaise: () => true }))
  await vm.loadProject(JSON.parse(JSON.stringify(customProject)))
  return JSON.parse(vm.toJSON()) as SerializedProject
}

const forkFixtureDir = path.resolve(here, '../../packages/scratch-vm/test/fixtures')

export const outputs = async (): Promise<Output[]> => {
  const custom = customFeaturesProject()
  const saved = await savedByEditor(custom)
  const list: Output[] = [
    { name: 'Custom mode: every custom feature (lowered directly)', project: lowerProject(custom), customFeatures: true },
    { name: 'Custom mode: every custom feature (saved through the editor)', project: saved, customFeatures: true },
    {
      name: 'Text mode (Python style)',
      project: applyText(
        saved,
        'Sprite1',
        'when flag_clicked:\n    score = 0\n    for _ in range(5):\n        score += 2\n    say(join("Score ", score))\n    broadcast("done")\n    add_to_list(log, score)\n',
        'python',
      ),
      customFeatures: false,
    },
    {
      name: 'Text mode (JavaScript style)',
      project: applyText(saved, 'Sprite1', 'when (flagClicked) {\n  while (!mouseDown()) {\n    turnRight(15);\n  }\n}\n', 'javascript'),
      // The text replaces the sprite's scripts, and "repeat until mouse down" has no custom form.
      customFeatures: false,
    },
  ]
  for (const name of fs.readdirSync(forkFixtureDir).filter((file) => file.endsWith('.sb3'))) {
    const data = fs.readFileSync(path.join(forkFixtureDir, name))
    const vm = createForkVm()
    try {
      await vm.loadProject(data)
    } catch {
      continue
    }
    const zip = await JSZip.loadAsync(data)
    const assets = new Map<string, Uint8Array>()
    for (const [file, entry] of Object.entries(zip.files)) {
      if (file !== 'project.json' && !entry.dir) assets.set(file, await entry.async('uint8array'))
    }
    list.push({
      name: `Stock project opened and saved in Custom mode: ${name}`,
      project: lowerProject(raiseProject(JSON.parse(vm.toJSON()) as SerializedProject)),
      assets,
      customFeatures: false,
    })
  }
  return list
}
