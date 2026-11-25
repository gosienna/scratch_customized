/// <reference types="vitest/config" />
import dts from 'unplugin-dts/vite'
import { defineConfig } from 'vite'
import packageJson from './package.json'

// Runtime dependencies are resolved by the consuming bundler (scratch-gui's webpack), not bundled here.
const externalDeps = [
  ...Object.keys(packageJson.dependencies || {}),
  ...Object.keys(packageJson.peerDependencies || {}),
].map((name) => new RegExp(`^${name}(?:/.*)?$`))

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'ScratchCustomizedPlatform',
      fileName: 'platform',
    },
    rolldownOptions: {
      external: externalDeps,
    },
  },
  plugins: [
    dts({
      insertTypesEntry: true,
      tsconfigPath: 'tsconfig.build.json',
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
  },
})
