import { describe, expect, test } from 'vitest'
import { ExprSyntaxError, parseExpression, printExpression } from '../src/expr/syntax'

const roundTrip = (source: string) => printExpression(parseExpression(source))

describe('parseExpression', () => {
  test('respects precedence and left associativity', () => {
    expect(parseExpression('a + b * c')).toEqual({
      kind: 'binary',
      op: '+',
      left: { kind: 'name', name: 'a' },
      right: {
        kind: 'binary',
        op: '*',
        left: { kind: 'name', name: 'b' },
        right: { kind: 'name', name: 'c' },
      },
    })
    expect(roundTrip('a - b - c')).toBe('a - b - c')
    expect(roundTrip('a - (b - c)')).toBe('a - (b - c)')
    expect(roundTrip('(var1+var2)/2')).toBe('(var1 + var2) / 2')
  })

  test('keeps number text exactly as typed', () => {
    expect(parseExpression('007')).toEqual({ kind: 'number', text: '007' })
    expect(parseExpression('-1.50')).toEqual({ kind: 'number', text: '-1.50' })
    expect(roundTrip('x - -5')).toBe('x - (-5)')
  })

  test('supports bracketed and unicode names', () => {
    expect(parseExpression('[my score] + 分数')).toMatchObject({
      left: { kind: 'name', name: 'my score' },
      right: { kind: 'name', name: '分数' },
    })
    expect(roundTrip('[and] + 1')).toBe('[and] + 1')
  })

  test('desugars != <= >= into not', () => {
    expect(roundTrip('a != b')).toBe('not a = b')
    expect(roundTrip('a <= b')).toBe('not a > b')
    expect(roundTrip('a >= 1 and b ≠ 2')).toBe('not a < 1 and not b = 2')
  })

  test('boolean operators and functions', () => {
    expect(roundTrip('not (a > 1 or b < 2)')).toBe('not (a > 1 or b < 2)')
    expect(roundTrip('a && b || c')).toBe('a and b or c')
    expect(roundTrip('sqrt(x * x + y*y)')).toBe('sqrt(x * x + y * y)')
    expect(roundTrip('x mod 3 = 0')).toBe('x mod 3 = 0')
    expect(roundTrip('join(\'a\', "b\\"c")')).toBe('join("a", "b\\"c")')
  })

  test('reports errors with positions', () => {
    expect(() => parseExpression('(a + b')).toThrow(ExprSyntaxError)
    expect(() => parseExpression('a +')).toThrow('Expression ends too early')
    expect(() => parseExpression('foo(1)')).toThrow('Unknown function "foo"')
    expect(() => parseExpression('random(1)')).toThrow('random() takes 2 arguments')
    try {
      parseExpression('a $ b')
    } catch (error) {
      expect((error as ExprSyntaxError).position).toBe(2)
    }
  })
})
