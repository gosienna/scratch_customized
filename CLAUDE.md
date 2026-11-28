# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## This fork: scratch_customized

A learner-oriented editor built on the scratch-editor monorepo (merged from `upstream` at tag `v15.3.0`).
Design and status: [PLAN.md](PLAN.md). Upstream's own guide (conventions, packages, commit rules) is AGENTS.md
above; everything there applies here too. Commit messages must be Conventional Commits with a lowercase subject
(husky + commitlint reject others).

### The one rule that matters
Saved `.sb3` files must open unchanged in official Scratch. Editor-only blocks (`operator_expression`,
`operator_condition`, `sensing_mouseup`) exist only in memory: `packages/platform/src/compat/lower.ts` turns them
into stock blocks on every save (via `vm.setProjectTransforms`, installed in `scratch-gui/src/lib/customized/
install-platform.js`), and `raise.ts` turns recognizable stock patterns back on load in Custom/Text mode. Any new
editor-only feature needs a lowering, a raising rule, and a runtime that behaves exactly like the lowered blocks
(checked by `packages/platform/test/vm/differential.test.ts` and `test/compat/`).

### Where things are
- `packages/platform/` (TypeScript, Vite, Vitest): assistant (AI helper: project summary, test runs, console
  capture, Claude tool loop), compat (lower/raise), expr (typed expressions), runtime (VM primitives), storage
  (folder / Drive backups), text (Python/JS text mode), vcs (Git history; `bundle.ts` packs a repository into the
  one-file backup). The GUI imports its **built** `dist/`.
- AI helper: `containers/customized/ai-assistant-panel.jsx` (chat panel, toggled by the menu bar's Helper button,
  `reducers/ai-assistant.js`). It calls the Anthropic API from the browser with a key each user pastes (kept in
  localStorage), with a model picker in the panel (Haiku 5.5 default, Sonnet 5.5, Opus 5.5). It reads, test-runs and sees costumes, and can select a sprite and scroll the code area to a
  block (`lib/customized/ai-editor-view.js`); it changes the project (code via `applyText`, new sprites, SVG costumes
  and comments, `lib/customized/ai-project-editor.js`) only when Settings > AI helper is set to "Can also change
  the project" (off by default).
- Projects are Git repositories in the browser (LightningFS); Save = commit. `scratch-gui/src/lib/customized/
  project-repo.js` commits, backs up and opens projects; a `.sb3` is only ever made on export.
- `packages/scratch-gui/src/{lib,containers}/customized/` and `reducers/{editor-mode,project-storage}.js`: the
  GUI side. Edits to upstream files are marked `// CUSTOM`.
- `packages/scratch-vm/src/virtual-machine.js`: the transform hook (`setProjectTransforms`, `addPrimitives`).
- `test/compat/`: standalone package that tests against the **official** npm scratch-vm and official GUI.

### Commands
```sh
npm ci                                                   # install (Node version: .nvmrc)
for p in task-herder scratch-storage scratch-svg-renderer scratch-render scratch-paint scratch-vm platform; do
  NODE_ENV=production npm run build --workspace=packages/$p; done   # the GUI uses these packages' dist/
npm start                                                # editor at http://localhost:8601
npm test --workspace=packages/platform                   # lint + all platform tests
cd packages/platform && npx vitest run test/text.test.ts -t "line numbers"   # one test file / test name
cd packages/scratch-gui && npx jest test/unit            # GUI unit tests
cd test/compat && npm ci && npm test                     # compatibility Levels 1–2 (see test/compat/README.md)
npm run build:pages                                      # static site for GitHub Pages in dist-pages/
```
- After changing `packages/platform` or `packages/scratch-vm`, rebuild that package **and restart `npm start`**:
  webpack caches `node_modules` (the workspace symlinks), so it does not see rebuilt `dist/` files.
- The platform's `src/` uses `noUncheckedIndexedAccess`; its tests (`test/tsconfig.json`) do not.
