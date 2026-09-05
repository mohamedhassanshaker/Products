/**
 * A deliberately tiny, safe subset-evaluator for `PermissionConditionSchema.expression`
 * (LLD §3.6: "CEL-subset, evaluated sandboxed; e.g. `args.amount > 5000`"). This is
 * NOT a general expression language and never calls `eval`/`Function` on
 * user-influenced input (a hard security-review requirement — "no dynamic execution
 * of user-influenced strings"). It recognizes exactly one grammar:
 *
 *   args.<propertyPath> <op> <numberLiteral | quotedStringLiteral>
 *
 * where `<op>` is one of `> >= < <= == !=`. Anything else fails **closed** (returns
 * `false`, never throws into the resolver, never matches) — an admin-authored rule
 * with an unsupported expression simply never matches via that clause, which is the
 * conservative failure direction for a permission system.
 */
const EXPRESSION_RE = /^args\.([a-zA-Z_][a-zA-Z0-9_.]*)\s*(>=|<=|==|!=|>|<)\s*(-?\d+(?:\.\d+)?|"[^"]*")$/;

export function evaluateExpression(expression: string, args: Record<string, unknown> | undefined): boolean {
  const match = EXPRESSION_RE.exec(expression.trim());
  if (!match) return false;
  const [, path, op, rawLiteral] = match;
  if (path === undefined || op === undefined || rawLiteral === undefined) return false;

  const actual = getPath(args ?? {}, path);
  const literal = rawLiteral.startsWith('"') ? rawLiteral.slice(1, -1) : Number(rawLiteral);

  if (actual === undefined) return false;

  switch (op) {
    case ">":
      return Number(actual) > Number(literal);
    case ">=":
      return Number(actual) >= Number(literal);
    case "<":
      return Number(actual) < Number(literal);
    case "<=":
      return Number(actual) <= Number(literal);
    case "==":
      return String(actual) === String(literal);
    case "!=":
      return String(actual) !== String(literal);
    default:
      return false;
  }
}

function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}
