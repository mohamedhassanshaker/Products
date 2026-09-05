import { evaluateCondition, GraphConditionError, parseCondition } from './graph-condition';

describe('parseCondition', () => {
  it('parses == with a double-quoted string literal', () => {
    expect(parseCondition('utterance == "hello"')).toEqual({ field: 'utterance', op: '==', literal: 'hello' });
  });

  it('parses == with a single-quoted string literal', () => {
    expect(parseCondition("utterance == 'hello'")).toEqual({ field: 'utterance', op: '==', literal: 'hello' });
  });

  it('parses != with a string literal', () => {
    expect(parseCondition('intent != "billing"')).toEqual({ field: 'intent', op: '!=', literal: 'billing' });
  });

  it('parses == with an integer literal', () => {
    expect(parseCondition('attempt == 3')).toEqual({ field: 'attempt', op: '==', literal: 3 });
  });

  it('parses == with a negative number literal', () => {
    expect(parseCondition('score == -1')).toEqual({ field: 'score', op: '==', literal: -1 });
  });

  it('parses == with a decimal number literal', () => {
    expect(parseCondition('confidence == 0.5')).toEqual({ field: 'confidence', op: '==', literal: 0.5 });
  });

  it('parses in with a bracketed string list literal', () => {
    expect(parseCondition('intent in ["billing", "support"]')).toEqual({
      field: 'intent',
      op: 'in',
      literal: ['billing', 'support'],
    });
  });

  it('parses in with a single-element bracketed list', () => {
    expect(parseCondition('intent in ["billing"]')).toEqual({ field: 'intent', op: 'in', literal: ['billing'] });
  });

  it('parses in with an empty bracketed list', () => {
    expect(parseCondition('intent in []')).toEqual({ field: 'intent', op: 'in', literal: [] });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseCondition('  utterance   ==   "hi"  ')).toEqual({ field: 'utterance', op: '==', literal: 'hi' });
  });

  it('an identifier field name may contain underscores and digits', () => {
    expect(parseCondition('turn_count_2 == 3')).toEqual({ field: 'turn_count_2', op: '==', literal: 3 });
  });

  it('throws GraphConditionError for `in` given a non-bracketed literal', () => {
    expect(() => parseCondition('intent in "billing"')).toThrow(GraphConditionError);
  });

  it('throws GraphConditionError for an unsupported operator', () => {
    expect(() => parseCondition('attempt > 3')).toThrow(GraphConditionError);
  });

  it('throws GraphConditionError for a bare identifier with no operator/literal', () => {
    expect(() => parseCondition('utterance')).toThrow(GraphConditionError);
  });

  it('throws GraphConditionError for an unquoted, non-numeric literal', () => {
    expect(() => parseCondition('utterance == hello')).toThrow(GraphConditionError);
  });

  it('throws GraphConditionError for a boolean combinator (&&) — grammar has no combinators', () => {
    expect(() => parseCondition('utterance == "a" && intent == "b"')).toThrow(GraphConditionError);
  });

  it('throws GraphConditionError for a function-call-shaped string', () => {
    expect(() => parseCondition('utterance == process.exit()')).toThrow(GraphConditionError);
  });

  it('throws GraphConditionError for an empty string', () => {
    expect(() => parseCondition('')).toThrow(GraphConditionError);
  });

  it('throws GraphConditionError for a field name starting with a digit (not a valid identifier)', () => {
    expect(() => parseCondition('1field == "x"')).toThrow(GraphConditionError);
  });

  /**
   * The plan doc describes the allow-listed field set as `utterance` or
   * `state.<key>` (a dotted turn-state lookup). The actual field regex here
   * (`[a-zA-Z_][a-zA-Z0-9_]*`) does not include `.` in the character class,
   * so a dotted field like `state.intent` fails to match the grammar at all
   * and throws, rather than being treated as a turn-state lookup. Asserted
   * here as the real, current behavior of this production file (not
   * redesigned as part of this test pass) — a real interpreter caller must
   * populate turn-state under a flat (non-dotted) key name for a condition
   * to ever match it.
   */
  it('a dotted field name (e.g. state.intent) does not match the grammar and throws, despite the plan doc describing state.<key> as a supported field form', () => {
    expect(() => parseCondition('state.intent == "billing"')).toThrow(GraphConditionError);
  });
});

describe('evaluateCondition', () => {
  it('== matches an equal string field', () => {
    expect(evaluateCondition('utterance == "hi"', { utterance: 'hi' })).toBe(true);
  });

  it('== does not match a differing string field', () => {
    expect(evaluateCondition('utterance == "hi"', { utterance: 'bye' })).toBe(false);
  });

  it('== matches an equal number field', () => {
    expect(evaluateCondition('attempt == 3', { attempt: 3 })).toBe(true);
  });

  it('!= matches a differing field', () => {
    expect(evaluateCondition('intent != "billing"', { intent: 'support' })).toBe(true);
  });

  it('!= does not match an equal field', () => {
    expect(evaluateCondition('intent != "billing"', { intent: 'billing' })).toBe(false);
  });

  it('in matches a field present in the list', () => {
    expect(evaluateCondition('intent in ["billing", "support"]', { intent: 'support' })).toBe(true);
  });

  it('in does not match a field absent from the list', () => {
    expect(evaluateCondition('intent in ["billing", "support"]', { intent: 'sales' })).toBe(false);
  });

  it('in against an empty list literal never matches', () => {
    expect(evaluateCondition('intent in []', { intent: 'anything' })).toBe(false);
  });

  it('an unknown field name evaluates to false for ==, never throws', () => {
    expect(evaluateCondition('does_not_exist == "x"', { utterance: 'hi' })).toBe(false);
  });

  it('an unknown field name evaluates to true for != (undefined !== literal), never throws', () => {
    expect(evaluateCondition('does_not_exist != "x"', { utterance: 'hi' })).toBe(true);
  });

  it('an unknown field name evaluates to false for in, never throws', () => {
    expect(evaluateCondition('does_not_exist in ["x", "y"]', { utterance: 'hi' })).toBe(false);
  });

  it('does not coerce types — a number field never equals a string literal', () => {
    expect(evaluateCondition('attempt == "3"', { attempt: 3 })).toBe(false);
  });

  it('throws GraphConditionError (not a silent false) for a malformed condition string', () => {
    expect(() => evaluateCondition('attempt > 3', { attempt: 3 })).toThrow(GraphConditionError);
  });

  it('never uses eval or Function on the condition or turn-state (static source-text assertion)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path');
    const source = fs.readFileSync(path.join(__dirname, 'graph-condition.ts'), 'utf8');
    expect(source).not.toMatch(/\beval\s*\(/);
    expect(source).not.toMatch(/new\s+Function\s*\(/);
  });
});
