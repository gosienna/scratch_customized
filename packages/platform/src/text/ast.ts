/** A language-neutral form of a sprite's scripts, shared by the Python-style and JavaScript-style texts. */
import type { ExprNode } from '../expr/syntax'

export type Stmt =
  | { kind: 'call'; name: string; args: ExprNode[]; line?: number }
  | { kind: 'set'; variable: string; value: ExprNode; line?: number }
  | { kind: 'change'; variable: string; value: ExprNode; line?: number }
  | { kind: 'if'; condition: ExprNode | null; then: Stmt[]; else?: Stmt[]; line?: number }
  | { kind: 'forever'; body: Stmt[]; line?: number }
  | { kind: 'repeat'; times: ExprNode; body: Stmt[]; line?: number }
  /** `repeat until <condition>`: written `while not condition` / `while (!(condition))`. */
  | { kind: 'until'; condition: ExprNode | null; body: Stmt[]; line?: number }
  /** A block with no text form, kept as JSON. */
  | { kind: 'raw'; json: string; line?: number }

export type ScriptHead =
  /** A hat block: its spec name and arguments, or `scratch_hat` with the JSON of an unknown hat. */
  | { kind: 'hat'; name: string; args: ExprNode[] }
  | { kind: 'define'; proccode: string; params: string[]; warp: boolean; functionName: string }
  /** A stack with no hat. */
  | { kind: 'stack' }

export interface Script {
  head: ScriptHead
  body: Stmt[]
  x?: number
  y?: number
  line?: number
}

/** Raw block JSON: the block and every block nested in its inputs, with the first one as the root. */
export interface RawBlockJson {
  root: string
  blocks: Record<string, unknown>
}

export class TextSyntaxError extends Error {
  readonly line: number

  constructor(message: string, line: number) {
    super(`Line ${line}: ${message}`)
    this.name = 'TextSyntaxError'
    this.line = line
  }
}
