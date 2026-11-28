# Plan: Custom Scratch-based coding platform

> This is the original plan. **See "Implementation status" at the end** for what was built, where it differs
> from the plan, and what is still open.

## Context
The repo `scratch_customed` is empty (README + CLAUDE.md only). Goal: a browser-based, Scratch-like coding platform for programming learners with:
- Scratch UI (based on upstream scratch-gui), switchable between **Original**, **Custom (default)**, and **Text** modes
- `.sb3` files that are 100% compatible with scratch.mit.edu and Scratch Desktop
- Storage: browser IndexedDB, local PC folder, Google Drive
- First custom features: distinct global vs private variable UI, block-local variables for custom blocks, typed expressions such as `(var1+var2)/2`, and a "mouse up?" sensing block

Decisions already made with the user:
- Fork the **scratchfoundation/scratch-editor** monorepo. The standalone scratch-gui repo was archived in June 2026. The code is **AGPL-3.0**, so this project must be AGPL too.
- Deliver as a **web app only**. Local folders use the File System Access API; other browsers fall back to download/upload.
- Save block-local variables as **namespaced sprite variables** (`blockName::var`). These are not recursion-safe, and that is acceptable.
- The text GUI supports **both Python-style and JavaScript-style** syntax.

## Core design principle: "lower on save, raise on load"
Official Scratch rejects projects with unknown opcodes. Custom features may exist **at runtime** (in the VM and editor) but must be **lowered** to stock blocks when serializing. In Custom mode they are **raised** back from recognizable stock patterns when loading. No hidden metadata is required, so files stay clean in official Scratch.

| Feature | Runtime form (Custom mode) | Saved .sb3 form (stock) | Raise rule on load |
|---|---|---|---|
| Mouse up? | `sensing_mouseup` boolean | `operator_not(sensing_mousedown)` | That exact pattern → `sensing_mouseup` |
| Typed expression | `custom_expr` reporter holding text | Tree of `operator_add/subtract/multiply/divide/mod/lt/gt/equals/and/or/not` + variable/number leaves | Pure-math operator trees with ≥2 operators → `custom_expr` (user setting, "expand to blocks" in the context menu) |
| Block-local var | Variable with `scope: procedure` | Sprite-local variable named `procName::var` (normal `data_*` opcodes) | Name prefix matches a procedure in that sprite → local scope |
| Global/private var UI | Rendering only | Unchanged (stage vars vs sprite vars already exist in sb3) | n/a |

A save-time guard checks that every opcode in the output is in the stock VM's primitive and extension set. If any is not, the save fails loudly instead of writing an incompatible file.

## Repo layout
```
/upstream/              git subtree of scratchfoundation/scratch-editor (pinned commit)
  packages/scratch-gui, scratch-vm, scratch-render, scratch-storage, scratch-paint, ...
/packages/scratch-blocks/  vendored fork of scratch-blocks (not in the monorepo; needed for variable rendering)
/packages/platform/     our code: mode state, lowering/raising, storage, text GUI
/test/fixtures/         sample .sb3 files (stock + custom-feature projects)
```
- Use npm workspaces at the root, with the Node version taken from upstream `.nvmrc`.
- Keep upstream edits small and marked with `// CUSTOM:` so rebasing on new upstream versions stays manageable. Put the real logic in `packages/platform`.
- Step 0 must confirm which scratch-blocks version upstream pins, then vendor exactly that version.

## Implementation phases

### Phase 0: Scaffolding
- Import the monorepo with `git subtree add`, add a root `package.json` with workspaces, and add LICENSE (AGPL-3.0).
- Confirm stock `npm install && npm start` serves the editor at `localhost:8601`.
- Update CLAUDE.md with the real commands.

### Phase 1: Mode switcher and storage
**Mode state**: add a Redux slice `editorMode: 'original' | 'custom' | 'text'` in `upstream/packages/scratch-gui/src/reducers/`. Persist it in localStorage and default to `custom`. Add a mode menu to `src/components/menu-bar/menu-bar.jsx`.
- All modes share **one VM instance**, so switching modes never reloads the project.
- **Original**: stock toolbox and blocks, and all custom block definitions unregistered. If the project contains custom runtime blocks, they are lowered in place first, using the same lowering pass.
- **Custom**: custom toolbox via `src/lib/make-toolbox-xml.js`, custom block definitions via `src/lib/blocks.js`.
- **Text**: replace the blocks workspace pane with the text editor. Stage, sprite list and costumes stay as they are.

**Storage** (`packages/platform/src/storage/`): one interface, `ProjectStore { list(), load(id) → ArrayBuffer, save(id, name, ArrayBuffer), remove(id) }`.
- `IndexedDBStore`: use the `idb` library, store sb3 blobs plus thumbnail and metadata, and autosave.
- `LocalFolderStore`: `showDirectoryPicker()`, with the directory handle persisted in IndexedDB and permission re-requested on reload. Fall back to download/upload on Firefox and Safari.
- `GoogleDriveStore`: Google Identity Services token client with the full `drive` scope and Drive v3 REST multipart upload, using mime `application/x.scratch.sb3`. Projects live in one linked Drive folder (pasted link or Google Picker), which may be shared with the user or in a shared drive. The OAuth client ID, Picker API key and Cloud project number come from env config (webpack `DefinePlugin`).
- Thumbnails (a PNG of the stage) are kept beside each project, never inside the .sb3: an IndexedDB store, a `.thumbnails/` subfolder, or Drive's `contentHints.thumbnail`.
- Every backend reads and writes bytes only through `vm.saveProjectSb3()` and `vm.loadProject()`, which pass through the lowering and raising hooks below.
- The menu bar's folder icon opens a full-window My Projects page (`containers/customized/project-library.jsx`): a card grid with thumbnails per store, a save bar, and prompts to choose a local folder, sign in to Google, or link a Drive folder.

### Phase 2: Lowering/raising infrastructure
- Add `packages/platform/src/compat/lower.js` and `raise.js`. These are pure functions over sb3 `project.json` objects, which makes them easy to unit test.
- Hook them into `upstream/packages/scratch-vm/src/serialization/sb3.js`: `serialize()` → `lower()` → opcode guard, and `deserialize()` → `raise()` when the mode is `custom`.
- Add `packages/platform/src/compat/stock-opcodes.js`, generated at build time from the stock VM's primitives and core extension blocks.

### Phase 3: Custom-mode features
1. **Global vs private variables** (scratch-blocks fork `core/data_category.js`, `core/colours.js`, `blocks_vertical/data.js`):
   - Split the Variables palette into "🌐 Global (all sprites)" and "🔒 This sprite only" sections.
   - Give the two kinds of reporter different colors and a leading icon. Global uses the stock orange plus a globe; private uses a distinct teal plus a lock.
   - Use the VM's `isLocal` flag on workspace variables, and apply the same styling to `set`/`change` dropdowns.
   - Make the scope choice more prominent in the "Make a variable" dialog (`src/components/prompt/`).
2. **Block-local variables**:
   - Extend the custom procedure dialog (`src/containers/custom-procedures.jsx`) with a "Local variables" list.
   - Create each local variable as a sprite variable named `procName::var`.
   - Hide these variables from the sprite palette section and show them in a "Locals of <block>" section while editing that definition.
   - Show reporters with the short name `var` and a distinct style.
   - Renaming the procedure renames its locals.
   - Known limitation: locals are shared across recursive calls. Document this in the UI tooltip.
3. **Typed expressions**:
   - Add `packages/platform/src/expr/`: a tokenizer and a Pratt parser for `+ - * / % ( ) < > = and or not`, numbers, string literals and variable names (quoting `[my var]` for names with spaces). It returns an AST, then converts it to an operator block tree.
   - Add a `custom_expr` reporter with an editable text field that shows red when the text does not parse. Its runtime implementation evaluates the AST against the target's variables.
   - In Custom mode, typing an expression directly into any number slot creates a `custom_expr` block.
   - Add a context menu with "Expand to blocks" and "Convert to expression".
4. **Mouse up**:
   - Add a `sensing_mouseup` boolean primitive in the scratch-vm fork (`src/blocks/scratch3_sensing.js`): `!ioQuery('mouse', 'getIsDown')`.
   - Add its block definition and toolbox entry next to "mouse down?".
   - It is lowered and raised as described in the table above.

### Phase 4: Text mode (Python-style and JavaScript-style)
Add `packages/platform/src/text/`:
- `opcode-map.js`: a single table mapping opcodes to function names and argument order (e.g. `motion_movesteps` ↔ `move(steps)`), shared by both syntaxes. Unmapped opcodes round-trip as `raw("opcode", {...})`.
- `ast.js`: a language-neutral script AST covering hats, statements, control (if/else, repeat, forever, until), procedures and expressions.
- `printers/python.js`, `printers/js.js`: block → AST → text, one sprite per file view. Hats are written as decorated functions (`@when_flag_clicked`) in Python and as `whenFlagClicked(() => {...})` in JS.
- `parsers/python.js`, `parsers/js.js`: hand-written recursive-descent parsers (text → AST → blocks), reusing the `expr` parser for expressions.
- Editor: **CodeMirror 6** with a per-sprite tab and a Python/JS toggle. Errors are shown inline.
- Applying edits:
  - Parse on debounce. On success, replace the target's scripts via VM block APIs.
  - Keep script x/y positions with trailing `# @pos(x,y)` / `// @pos(x,y)` comments. Auto-layout scripts that have no position comment.
  - On a parse error the VM is not touched.

### Phase 4b: Version control with Git (isomorphic-git)
Add `packages/platform/src/vcs/`, using `isomorphic-git` with `lightning-fs` (IndexedDB-backed) or a File System Access adapter for local folders.
- **Repo layout for each project**, stored unzipped so diffs are readable:
  ```
  project.json          pretty-printed, keys sorted, run through lower() so it is always stock sb3
  assets/<md5>.<ext>    costumes and sounds (content-addressed, already deduped)
  text/<sprite>.py      generated by the Phase 4 printers, read-only, for diffs only
  ```
  `project.json` is the single source of truth. When checking out a version, rebuild the sb3 by zipping `project.json` and the assets, then pass it to `vm.loadProject()`. The `text/` files are regenerated on every commit and never parsed back.
- **Where the repo lives**: the browser by default (`lightning-fs`), or the user's chosen local folder (a File System Access adapter implementing isomorphic-git's `fs` interface).
- **Remote**: optionally push and pull to GitHub or GitLab over HTTPS with a token, using OAuth device flow or a personal access token stored in IndexedDB. isomorphic-git needs a CORS proxy for GitHub, so make it configurable and self-hostable (`@isomorphic-git/cors-proxy`).
- **UI** (a "History" panel next to the sprite pane):
  - Commit with a message, and optionally auto-commit on every save.
  - History log with thumbnails. A commit hook saves a stage thumbnail as `thumbnail.png`.
  - Checkout or restore a commit, or "open as copy".
  - Diff view: per-sprite line diff of `text/*.py` between two commits, plus added and removed costumes and sounds.
  - Branches: create, switch and delete. Merging is **out of scope** for now; on conflicts, only "keep mine" or "keep theirs" per sprite.
- The `.sb3` export is unchanged and always comes from the working copy, so it stays compatible with official Scratch.

### Phase 5: Compatibility test suite (written alongside each phase)
- Unit tests (Jest, the upstream convention) for `lower`, `raise`, `expr`, the text printers and parsers, and the storage backends (IndexedDB backend via `fake-indexeddb`).
- Round-trip tests for every fixture: load → save → validate with **`scratch-parser`** (the validator official Scratch uses) and the opcode guard. Also check that `raise(lower(p))` and `lower(raise(p))` give equivalent results.
- VCS tests (`isomorphic-git` on an in-memory fs): commit → checkout → rebuilt sb3 equals the original byte for byte after normalization; branch switch restores the right project; the sb3 rebuilt from a commit passes `scratch-parser`.
- Text round-trip: blocks → Python → blocks and blocks → JS → blocks give equivalent block graphs for all stock fixtures.

### Phase 5b: Official Scratch loading test plan
Goal: prove that every `.sb3` file we produce loads and behaves identically in official Scratch. Tests live in `test/compat/` and run in CI on every PR.

**Reference "official" runtime**
- Install the **unmodified** upstream packages from npm in an isolated workspace, `test/compat/official/`, pinned to the versions scratch.mit.edu currently uses. Read the versions from the live editor's bundled `scratch-vm` version string, and update them with a monthly script.
- Never import our fork there. The compat tests load our output into the official VM and GUI only.

**Level 1: Static validation (Jest, fast)**
For every saved fixture:
- It passes the official `scratch-parser` (zip + sb3 JSON schema).
- The opcode guard passes: every opcode is in the official VM's `runtime._primitives` and core extensions, and every `extensions[]` entry is an official extension ID.
- Structural rules:
  - `meta.semver === "3.0.0"`.
  - Every block's `parent`/`next`/`inputs` reference an existing block ID.
  - Every variable or list referenced in a block exists in the target or stage, with matching IDs.
  - Every broadcast referenced exists on the stage.
  - Every `assetId`/`md5ext` is present in the zip with the correct MD5, and `dataFormat` is one of svg/png/jpg/bmp/gif/wav/mp3.
  - Monitors reference valid IDs.
  - Variable names don't collide after lowering, e.g. a user variable already called `proc::x`. Collisions are auto-renamed.
- Size limits match the official uploader's per-asset and `project.json` limits, read from upstream code at implementation time. Exceeding them produces a warning in the save dialog.

**Level 2: Official VM load + behavioral equivalence (Jest/Node, headless)**
- Load each saved sb3 into the **official** `scratch-vm`, and assert that no load error occurs and the counts of targets, blocks, variables and costumes are as expected.
- Differential execution: run (a) the in-memory Custom-mode project in our VM and (b) the lowered sb3 in the official VM.
  - Seed `Math.random`, mock `timer`/`Date`, and script inputs (mouse down/up sequences, key presses) frame by frame.
  - Step both VMs for N frames, then compare each target's x, y, direction, size, costume, visibility, variables, lists and the say/think text.
  - Any difference fails the test with a frame-by-frame diff.
- Fixtures covering each custom feature:
  - mouse up inside `if`, `wait until`, `repeat until`
  - typed expressions with precedence, division by zero, string concatenation edge cases and nested parentheses
  - block-local variables in several procedures, including procedures with the same name in different sprites
  - global and private variables with the same name
  - every feature combined

**Level 3: Official GUI load (Playwright, headless Chrome)**
- Build the unmodified official `scratch-gui` from the same pinned npm version and serve it locally.
- For each fixture, use File → Load from your computer, then assert:
  - no error alert or "could not load project" dialog
  - no console errors
  - the workspace renders the expected number of top-level scripts
  - green-flag run for 2 seconds raises no runtime exceptions
- Save it again from the official GUI, then load that file into our platform in Custom mode. Assert the features are raised back (tests the reverse direction).

**Level 4: Reverse direction (official → ours → official)**
- Use a corpus of about 50 CC-licensed projects downloaded from scratch.mit.edu covering extensions, clones, cloud variables, lists, monitors, pen and music, stored in `test/fixtures/official/`.
- For each one, load it in each of our 3 modes, save it without edits, and normalize both files (sorted keys, ignore `meta.agent`).
- Original mode must produce a **semantically identical** project.json. Custom mode may only differ in ways the raise→lower round trip proves are equal, which is checked by Level 2 differential execution.
- Text mode: blocks → Python/JS → blocks must preserve Level 2 behavior.

**Level 5: Manual release checklist** (not automated, because scratch.mit.edu uploads require a login and bots are against its terms of use)
For each release, take 5 key fixtures and:
- upload each to scratch.mit.edu, open it in the online editor, press green flag, share-preview it, then download it and re-open it in our platform
- open each in the current Scratch Desktop on Windows and macOS
- record the results in `test/compat/MANUAL_CHECKLIST.md`

### Phase 6: Publishing to GitHub Pages
**Build**
- Add a root script `npm run build:pages` that builds `scratch-gui` with our platform code into `dist/` (`BUILD_MODE=dist`, production webpack).
- Set the webpack `publicPath` from the `PUBLIC_PATH` env var, defaulting to `/scratch_customed/` for a project site, or `/` with a custom domain.
- Audit every hard-coded root-relative URL in the gui (`/static/...`, worker paths, `extension-worker.js`) so the app works under a sub-path.
- Library costumes, sounds and backdrops keep loading from Scratch's public asset CDN, which is CORS-enabled, as stock scratch-gui does. Nothing large ships in `dist/`.
- Add `404.html` as a copy of `index.html` for client-side routes, plus `.nojekyll`.

**CI/CD** (`.github/workflows/`)
- `ci.yml`: on every PR, run `npm ci`, `npm test` and `npm run test:compat` (Levels 1–4, with Playwright browsers cached).
- `pages.yml`: on push to `main`, run tests and `build:pages`, then `actions/upload-pages-artifact` and `actions/deploy-pages`. Repo settings must use Pages source "GitHub Actions".
- Releases: a `v*` tag creates a GitHub Release with the zipped `dist/`, so classrooms can self-host offline. The main site always tracks `main`.

**Services a static site cannot host**
- Google Drive: create a Google Cloud OAuth client with authorized JavaScript origin `https://<user>.github.io` (plus `http://localhost:8601` for dev). Pass the client ID as a repo Actions variable (`GOOGLE_CLIENT_ID`) at build time. It is public, so no secret is involved.
  - The `drive` scope is restricted: users see an "unverified app" warning until Google verifies the app; add test users on the OAuth consent screen meanwhile.
  - For the folder Picker, enable the Google Picker API, create an API key restricted to the site origins, and pass it as `GOOGLE_PICKER_API_KEY` with the Cloud project number as `GOOGLE_APP_ID`. Without the key, only pasting a folder link is offered.
  - For local development, put the same variables in a `.env` file at the repository root (git-ignored); `packages/scratch-gui/webpack.config.js` loads it.
- Git remote CORS proxy (Phase 4b): deploy `@isomorphic-git/cors-proxy` as a small free Cloudflare Worker (`deploy/cors-proxy/`) and pass its URL at build time. If it is not configured, the remote push/pull UI hides itself and local Git still works.
- File System Access API and IndexedDB both work on Pages, because it is served over HTTPS.

**Extras**
- PWA: add a service worker via Workbox `GenerateSW` so the editor works offline after the first visit, with app updates shown as a "reload" banner.
- AGPL compliance: an About dialog in the menu bar links to the GitHub repo and the deployed commit SHA, injected at build time.

## Verification
1. `npm test` at the root runs all unit and round-trip tests. `npm run test:compat` runs compatibility Levels 1–4 against the official packages, and `npm run test:compat -- -t <fixture>` runs a single fixture.
2. `npm start`, then in Chrome via the Claude-in-Chrome tools:
   - Switch between all 3 modes on one project without losing state.
   - Build a project that uses all 4 custom features, run it, and confirm the behavior.
   - Save it to IndexedDB, a local folder and Google Drive, then reload it from each.
3. Manual compatibility check:
   - Upload the saved `.sb3` from step 2 to scratch.mit.edu and open it in Scratch Desktop. It must load without errors and behave the same, with mouse up showing as `not <mouse down?>` and locals as `proc::var` sprite variables.
   - Re-open the file in Custom mode and confirm the features are restored.
4. Git: make 3 commits on a project, view the diff between the first and third, create a branch and change it, switch back, and confirm the project is restored. Push to a test GitHub repo and check that `project.json` and `text/*.py` are readable there.
5. Pages:
   - Run `PUBLIC_PATH=/scratch_customed/ npm run build:pages && npx serve dist` and confirm the app loads under the sub-path with no 404s in the network panel.
   - After deploying, open `https://<user>.github.io/scratch_customed/`, load and save a project to each storage backend, and confirm it still works offline after reload.
6. Original mode: confirm that the toolbox and saves are indistinguishable from stock scratch-gui.

## Critical files
- New: `packages/platform/src/{compat,storage,expr,text,vcs}/`, root `package.json`, `LICENSE`, `CLAUDE.md`
- Patched upstream: `upstream/packages/scratch-gui/src/{reducers,lib/make-toolbox-xml.js,lib/blocks.js,containers/blocks.jsx,containers/custom-procedures.jsx,components/menu-bar/menu-bar.jsx,lib/project-saver-hoc.jsx}`, `upstream/packages/scratch-vm/src/{serialization/sb3.js,blocks/scratch3_sensing.js}`
- Patched fork: `packages/scratch-blocks/{core/data_category.js,core/colours.js,blocks_vertical/data.js}`

## Implementation status (2026-11-26)

### Done
| Area | Where | Verified by |
|---|---|---|
| VM save/load hook (`setProjectTransforms`, `addPrimitives`) | `packages/scratch-vm/src/virtual-machine.js` | tap test `test/unit/virtual-machine_project-transforms.js` |
| Lowering/raising, opcode guard | `packages/platform/src/compat/` | unit tests, raise→lower over all scratch-vm fixtures |
| Typed expressions, mouse up, block-local variable naming, runtime primitives | `packages/platform/src/{expr,runtime}/`, `local-vars.ts` | 120-frame differential run vs. stock blocks |
| Custom-mode GUI: blocks, scope colors, grouped Variables palette, "Add block-local variable" | `packages/scratch-gui/src/lib/customized/blocks.js` | browser checks |
| Editor modes (Settings > Editor: Custom / Text / Original Scratch) | `lib/customized/{editor-mode,switch-editor-mode}.js` | browser checks |
| Projects are Git repositories in the browser; Save = commit; the whole history is backed up as one Git bundle (`<name>.scratch.bundle`) to a local folder or Google Drive folder; old `.sb3` files there are imported; My Projects page with thumbnails | `packages/platform/src/{storage,vcs/bundle.ts}`, `lib/customized/project-repo.js`, `containers/customized/project-library.jsx` | bundle round trip + `git clone`/`fsck` by desktop Git; GUI service test (commit, backup, conflict, open, import); saved to and opened from Drive live |
| Branch chip and Commit button in the menu bar (Ctrl/Cmd+S, File > Save now) | `containers/customized/vcs-bar.jsx`, `components/customized/vcs-bar.jsx` | browser checks |
| Text mode, Python and JavaScript styles | `packages/platform/src/text/`, `containers/customized/text-code-panel.jsx` | round trip of every fixture in both dialects + behavior check; browser checks |
| Git version history (save, diff, open, download .sb3, branches, push) | `packages/platform/src/vcs/`, `containers/customized/history-modal.jsx` | Node test with a real repo; browser checks |
| Compatibility suite, Levels 1–3 and the manual checklist (Level 5) | `test/compat/` | 32 tests vs. official npm scratch-vm; 24 files opened in the official GUI built from the upstream tag |
| AI helper panel (Claude Haiku 5.5 by default, or Sonnet 5.5 / Opus 5.5 from the panel's model picker; user's own API key): reads sprites/scripts/state, sees costumes as pictures, runs the project or one script/loop for a few seconds, reads console errors tagged with the failing block; with Settings > AI helper > "Can also change the project" (off by default) it writes code, creates sprites and draws SVG costumes | `packages/platform/src/assistant/`, `containers/customized/ai-assistant-panel.jsx` | VM tests (`test/vm/assistant.test.ts`); browser checks |
| GitHub Pages build and deploy, CI | `scripts/build-pages.sh`, `.github/workflows/{ci,pages}.yml` | site served under `/scratch_customized/` with no failed requests |

### Differences from the plan
- **Layout**: the repository root *is* the fork of scratch-editor (merged at tag `v15.3.0`, remote `upstream`), not
  an `/upstream` subtree, because npm workspaces cannot nest. `packages/platform` is an added workspace.
- **No scratch-blocks fork**: the variable palette, colors and short names are done from the GUI through
  scratch-blocks' public hooks (toolbox category callback, Blockly registry), so scratch-blocks stays on npm.
- **VM changes are generic hooks**; all editor-only block implementations live in `packages/platform`.
- **Expressions use two blocks**: `operator_expression` (round) and `operator_condition` (hexagonal, for
  true/false slots). Invalid text never blocks a save: an invalid expression is saved as `join("<text>", "")`,
  an invalid condition as an empty slot (false); the runtime behaves the same.
- **Custom-block parameter types come from the proccode** (`%b` = boolean): current scratch-vm strips argument
  reporters from prototypes.
- **Mode switches and text edits save and reload the project** (same code path as a real save/load).
- **Text mode applies on demand** (button or Ctrl/Cmd+Enter) instead of while typing, so half-typed code never
  touches the project. About 90 blocks have a text form; every other block round-trips as `scratch_block(...)`.
- **Git is the only project format** (no `.sb3` stores): a project's repository lives in the browser, and a folder
  or Drive keeps a Git bundle of it (desktop Git can `git clone` it). A save that finds the backup changed elsewhere
  on the same branch keeps the commit locally and does not overwrite the backup (merge is not built yet).
  `.sb3` files are made only by File > Save to your computer and History > Download .sb3.
- **Pages path**: the GitHub repository is `scratch_customized`, so the site is at `/scratch_customized/`.
- Upstream's npm-release, preview-deploy, i18n and bot workflows were removed (they would fail in this fork).

### Not done yet
- Typing an expression directly into a number slot (use the `ƒ` block for now).
- Renaming a custom block does not rename its block-local variables; renaming a variable does not update
  expressions that mention it.
- Git: push only to GitHub (no pull); no merge yet, so a backup changed on two computers must be saved as a new
  project. Planned next: a Scratch-aware three-way merge with a per-sprite Resolve dialog, then autosave to the
  working tree, commit to another branch, and Put aside / Bring back (stash).
- Compatibility Level 4 (a corpus of ~50 real community projects).
- Offline service worker (PWA) and an About dialog linking the source (AGPL).
- Google Picker and the local-folder picker have not been tried live (the folder picker is a native dialog that
  automated browsers cannot drive). Whether Drive `thumbnailLink`s can be fetched from the page (CORS) is unverified;
  cards fall back to a placeholder if not.
