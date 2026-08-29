// DELIBERATE lint violations — do not "fix" this file, do not import it.
//
// It exists so infra/check-lint-rule.sh can prove the slipstream float-ban
// rules fire on a money path. Normal linting ignores infra/fixtures/**; this
// file is only ever linted explicitly with --no-ignore.

export function badPrice(raw: string): number {
  const parsed = parseFloat(raw); // slipstream/no-float-money (error)
  const coerced = Number(raw); // slipstream/no-number-coercion (error)
  return parsed * 1.15 + coerced; // float literal (error)
}
