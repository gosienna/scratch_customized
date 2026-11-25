# Official Scratch compatibility tests

Checks that every kind of file this editor saves opens and behaves the same in **unmodified** official Scratch.
This is a standalone package (not an npm workspace), so it installs the official `@scratch/scratch-vm` from npm
instead of this repository's fork.

```sh
cd test/compat
npm install
npm test                      # Levels 1–2: official validator, opcodes, references, frame-by-frame behavior
npm run build:official-gui    # clones and builds the official GUI at the pinned tag (once, ~1–2 minutes)
npm run write-outputs         # writes the editor's outputs as .sb3 files into .outputs/
npm run test:gui              # Level 3: opens each file in the official GUI with Playwright
```

- The official versions are pinned: `@scratch/scratch-vm` in `package.json` and `OFFICIAL_SCRATCH_TAG`
  (default `v15.3.0`) in `scripts/build-official-gui.sh`. Update them together when Scratch releases.
- Level 4 (a corpus of real community projects opened and saved in every mode) is not automated yet.
- Level 5 is manual: see [MANUAL_CHECKLIST.md](MANUAL_CHECKLIST.md).
