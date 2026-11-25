/**
 * Block-local variables of custom blocks. In the saved .sb3 file (and at runtime) each one is an ordinary
 * "for this sprite only" variable named `<block label>::<variable>`, so official Scratch runs it unchanged.
 * Custom mode shows these variables only while editing their block's definition, under their short name.
 *
 * They are not recursion-safe: recursive calls of the same block share one variable.
 */

export const LOCAL_VARIABLE_SEPARATOR = '::'

/**
 * The human-readable label of a custom block: its proccode without argument placeholders.
 * For example `jump %n high %b` becomes `jump high`.
 */
export const procedureLabel = (proccode: string): string =>
  proccode
    .replace(/%[snb]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export const localVariableName = (proccode: string, name: string): string =>
  `${procedureLabel(proccode)}${LOCAL_VARIABLE_SEPARATOR}${name}`

/**
 * If `variableName` is a block-local variable, return its block label and short name.
 */
export const parseLocalVariableName = (variableName: string): { label: string; name: string } | undefined => {
  const index = variableName.indexOf(LOCAL_VARIABLE_SEPARATOR)
  if (index <= 0) return undefined
  const name = variableName.slice(index + LOCAL_VARIABLE_SEPARATOR.length)
  if (!name) return undefined
  return { label: variableName.slice(0, index), name }
}

/**
 * True if `variableName` is a block-local variable of the custom block with this proccode.
 */
export const isLocalVariableOf = (variableName: string, proccode: string): boolean =>
  parseLocalVariableName(variableName)?.label === procedureLabel(proccode)

/**
 * Rename a block-local variable after its block's proccode changed.
 */
export const renameForProccode = (variableName: string, newProccode: string): string => {
  const parsed = parseLocalVariableName(variableName)
  return parsed ? localVariableName(newProccode, parsed.name) : variableName
}

/**
 * The type of each argument of a custom block, in `argumentids` order: `%b` is a boolean, `%s` and `%n` are
 * text/number. (Prototype blocks do not keep their argument reporters, so the proccode is the reliable source.)
 */
export const argumentTypesOf = (proccode: string): ('number' | 'boolean')[] =>
  (proccode.match(/%[snb]/g) ?? []).map((placeholder) => (placeholder === '%b' ? 'boolean' : 'number'))
