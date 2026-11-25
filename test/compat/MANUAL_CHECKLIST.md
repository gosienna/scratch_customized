# Manual compatibility checklist (before each release)

Automated tests cannot use scratch.mit.edu (uploading needs a signed-in account, and automated use is against
its terms), so these steps are done by hand. Use the `.sb3` files from `npm run write-outputs` (in `.outputs/`):
`00.sb3` (every custom feature), `02.sb3` (Python text), `03.sb3` (JavaScript text), plus one large real project.

For each file:

- [ ] scratch.mit.edu → Create → File > Load from your computer: loads with no error, all scripts visible
- [ ] Green flag: runs as it does in this editor
- [ ] File > Save to your computer, then open that file here in Custom mode: typed expressions and
      "mouse up?" come back
- [ ] Scratch Desktop (latest) on Windows: same three checks
- [ ] Scratch Desktop (latest) on macOS: same three checks

| Release | Date | Tester | scratch.mit.edu | Desktop (Win) | Desktop (Mac) | Notes |
|---------|------|--------|-----------------|---------------|---------------|-------|
|         |      |        |                 |               |               |       |
