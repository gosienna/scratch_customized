/** Text mode: show a sprite's scripts as Python-style or JavaScript-style text, and apply edited text. */
import { copyForRewrite } from '../compat/lower'
import { isProject, type SerializedJson, type SerializedProject, type SerializedTarget } from '../sb3/types'
import { type TextDialect, parseScripts, printScripts } from './dialects'
import { scriptsFromTarget } from './from-blocks'
import { blocksFromScripts } from './to-blocks'

export type { TextDialect }
export { TextSyntaxError } from './ast'

/** The text for one target's scripts. */
export const targetToText = (target: SerializedTarget, dialect: TextDialect): string =>
  printScripts(scriptsFromTarget(target), dialect)

/**
 * Return a copy of `project` in which the named target's scripts are replaced by the ones in `text`. Variables,
 * lists and broadcasts the text needs are created; comments attached to replaced blocks stay on the workspace.
 * Throws TextSyntaxError (with a line number) for mistakes; the project is not changed then.
 */
export const applyText = (
  project: SerializedProject,
  targetName: string,
  text: string,
  dialect: TextDialect,
): SerializedProject => {
  const copy = copyForRewrite(project)
  const target = copy.targets.find((candidate) => candidate.name === targetName)
  if (!target) throw new Error(`applyText: no sprite named "${targetName}"`)
  const stage = copy.targets.find((candidate) => candidate.isStage)
  const result = blocksFromScripts(target, target.isStage ? undefined : stage, parseScripts(text, dialect))
  target.blocks = result.blocks
  target.variables = { ...target.variables, ...result.newVariables }
  target.lists = { ...target.lists, ...result.newLists }
  if (stage) stage.broadcasts = { ...stage.broadcasts, ...result.newBroadcasts }
  for (const comment of Object.values(target.comments ?? {})) {
    if (comment.blockId) comment.blockId = null
  }
  return copy
}

export const isWholeProject = (json: SerializedJson): json is SerializedProject => isProject(json)
