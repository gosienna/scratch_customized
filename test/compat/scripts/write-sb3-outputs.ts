/**
 * Write every kind of file the editor saves as real .sb3 files (project.json plus its costumes and sounds) into
 * .outputs/, for the Level 3 browser tests. Each file has a matching .expect.json describing what to check.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { outputs } from '../outputs'

const here = path.dirname(fileURLToPath(import.meta.url))

const outDir = path.resolve(here, '../.outputs')
const defaultProjectAssets = path.resolve(here, '../../../packages/scratch-gui/src/lib/default-project')

const main = async () => {
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  const list = await outputs()
  for (const [index, output] of list.entries()) {
    const zip = new JSZip()
    zip.file('project.json', JSON.stringify(output.project))
    const assets = output.assets ?? new Map<string, Uint8Array>()
    const missing: string[] = []
    for (const target of output.project.targets) {
      for (const item of [...(target.costumes as { md5ext: string }[]), ...(target.sounds as { md5ext: string }[])]) {
        const fallback = path.join(defaultProjectAssets, item.md5ext)
        const data = assets.get(item.md5ext) ?? (fs.existsSync(fallback) ? fs.readFileSync(fallback) : undefined)
        if (data) zip.file(item.md5ext, data)
        else missing.push(item.md5ext)
      }
    }
    // Some scratch-vm fixtures test missing assets on purpose; they cannot be opened as complete files.
    if (missing.length) {
      console.log(`Skipping "${output.name}": its source has no ${missing.join(', ')}`)
      continue
    }
    const base = `${String(index).padStart(2, '0')}`
    fs.writeFileSync(path.join(outDir, `${base}.sb3`), await zip.generateAsync({ type: 'nodebuffer' }))
    fs.writeFileSync(
      path.join(outDir, `${base}.expect.json`),
      JSON.stringify({
        name: output.name,
        targets: output.project.targets.map((target) => ({
          name: target.name,
          scripts: Object.values(target.blocks).filter((block) => Array.isArray(block) || (block.topLevel && !block.shadow)).length,
        })),
        customFeatures: output.customFeatures,
      }),
    )
  }
  console.log(`Wrote ${fs.readdirSync(outDir).filter((file) => file.endsWith(".sb3")).length} projects to ${outDir}`)
}

void main()
