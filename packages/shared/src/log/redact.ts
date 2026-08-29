/**
 * The allowlist redactor.
 *
 * One rule, applied everywhere: walking a value, a key is kept only if
 * `isAllowedField(key)` says so, and every other key is omitted from the
 * output entirely. There is no second path — errors, causes, Maps and class
 * instances all go through this same filter, because the leak that matters is
 * always the one that took the path nobody filtered.
 *
 * The output of `redactValue` is guaranteed JSON-safe: no cycles, no `bigint`,
 * no `undefined` in object positions, no non-finite numbers, no `toJSON` hooks
 * left to run at stringify time. `JSON.stringify` on it cannot throw.
 *
 * See docs/04 §2 and docs/01 §6.
 */
import { isAllowedField } from "./allowlist.js"

/** Recursion budget. Deeper structures are cut off, not partially emitted. */
const MAX_DEPTH = 8

/** Markers. Every one is a constant: a marker must never carry data, or the
 *  fallback path becomes its own leak. */
const CIRCULAR = "[circular]"
const MAX_DEPTH_MARKER = "[max-depth]"
const INVALID_DATE = "[invalid-date]"
const GETTER_THREW = "[getter-threw]"
const SECRET_SHAPE = "[redacted:64hex]"

/**
 * Belt-and-braces over the allowlist, added in review.
 *
 * `message` and `stack` are allowlisted because errors are useless without
 * them — but that means a throw site writing `` `bad key ${key}` `` puts
 * plaintext straight into an allowlisted field, and it was verified to leak.
 * The allowlist is the mechanism; this is the seatbelt for the one place the
 * mechanism cannot help, because the field is legitimately free text.
 *
 * 64 hex characters is the private-key shape on both venues (bare, and
 * 0x-prefixed for viem). A 32-byte transaction hash has the same shape and
 * will also be masked. That is a deliberate trade: a masked tx hash costs a
 * debugging session, a leaked key costs a user's funds.
 */
const SECRET_RE = /\b(?:0x)?[0-9a-fA-F]{64}\b/g
const scrubSecretShapes = (s: string): string => s.replace(SECRET_RE, SECRET_SHAPE)

/** Returned in place of a value that must not appear at all. Distinct from
 *  `undefined` so that "the caller passed undefined" and "we refuse to emit
 *  this" stay distinguishable inside the walk. */
const DROP = Symbol("drop")
type Dropped = typeof DROP

/** A value that survives `JSON.stringify` unchanged. */
export type Redacted =
  | string
  | number
  | boolean
  | null
  | readonly Redacted[]
  | { readonly [key: string]: Redacted }

/** Fields a caller may hand the logger. Values are `unknown` on purpose: the
 *  redactor, not the type system, decides what survives. */
export type LogFields = Readonly<Record<string, unknown>>

const isPlainKeyable = (v: object): boolean =>
  !ArrayBuffer.isView(v) && !(v instanceof ArrayBuffer) && !(v instanceof WeakMap) && !(v instanceof WeakSet)

/**
 * Filter an object's own enumerable string keys against the allowlist.
 *
 * The allowlist check happens *before* the property is read, so a getter under
 * a non-allowlisted name is never even invoked.
 */
const filterEntries = (
  source: object,
  depth: number,
  seen: WeakSet<object>,
): Record<string, Redacted> => {
  const out: Record<string, Redacted> = {}
  for (const key of Object.keys(source)) {
    if (!isAllowedField(key)) continue
    let raw: unknown
    try {
      raw = (source as Record<string, unknown>)[key]
    } catch {
      // A throwing getter is reported, not swallowed: a silently missing field
      // reads as "the caller did not set it", which is a different bug.
      out[key] = GETTER_THREW
      continue
    }
    const value = redactValue(raw, depth + 1, seen)
    if (value !== DROP) out[key] = value
  }
  return out
}

/**
 * Errors, redacted through the same filter as anything else.
 *
 * `name`, `message` and `stack` are non-enumerable on `Error`, and `cause` is
 * non-enumerable when set via `new Error(msg, { cause })`, so `Object.keys`
 * alone would silently emit an error as `{}`. They are extracted explicitly and
 * then subjected to the identical allowlist check — extraction is the only
 * concession errors get, never exemption.
 *
 * Any extra own property somebody hung on the error (`err.apiKey = ...`, the
 * classic) is filtered exactly as it would be on a plain object: dropped.
 */
const redactError = (err: Error, depth: number, seen: WeakSet<object>): Redacted => {
  // Own enumerable extras first, so the canonical fields below always win.
  const out: Record<string, Redacted> = filterEntries(err, depth, seen)

  for (const key of ["name", "message", "stack"] as const) {
    if (!isAllowedField(key)) continue
    const value = (err as unknown as Record<string, unknown>)[key]
    if (typeof value === "string") out[key] = scrubSecretShapes(value)
  }

  if ("cause" in err && isAllowedField("cause")) {
    const cause = redactValue((err as { cause?: unknown }).cause, depth + 1, seen)
    if (cause !== DROP) out["cause"] = cause
  }

  // AggregateError carries its children on a non-enumerable `errors` array.
  const aggregate = (err as { errors?: unknown }).errors
  if (Array.isArray(aggregate) && isAllowedField("errors")) {
    const errors = redactValue(aggregate, depth + 1, seen)
    if (errors !== DROP) out["errors"] = errors
  }

  return out
}

const redactObject = (value: object, depth: number, seen: WeakSet<object>): Redacted | Dropped => {
  if (seen.has(value)) return CIRCULAR
  if (depth >= MAX_DEPTH) return MAX_DEPTH_MARKER

  seen.add(value)
  try {
    if (Array.isArray(value)) {
      // JSON has no holes: a dropped element becomes null rather than shifting
      // every later index and silently changing what the array means.
      return value.map((element) => {
        const redacted = redactValue(element, depth + 1, seen)
        return redacted === DROP ? null : redacted
      })
    }

    if (value instanceof Error) return redactError(value, depth, seen)

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? INVALID_DATE : value.toISOString()
    }

    if (value instanceof Set) {
      return [...value].map((element) => {
        const redacted = redactValue(element, depth + 1, seen)
        return redacted === DROP ? null : redacted
      })
    }

    if (value instanceof Map) {
      // A Map's keys are field names by another spelling, so they face the same
      // question. Non-string keys have no name to check and are dropped.
      const out: Record<string, Redacted> = {}
      for (const [key, raw] of value) {
        if (typeof key !== "string" || !isAllowedField(key)) continue
        const redacted = redactValue(raw, depth + 1, seen)
        if (redacted !== DROP) out[key] = redacted
      }
      return out
    }

    // Binary is dropped outright. A Buffer or TypedArray is exactly the shape
    // raw key material arrives in, and it has no field names to filter.
    if (!isPlainKeyable(value)) return DROP

    // NOTE: `toJSON` is deliberately not consulted. Honouring it would hand an
    // arbitrary object the ability to emit a string of its choosing, bypassing
    // the allowlist entirely — which is precisely the "add a toJSON to make it
    // safe to log" move that docs/04 §2 forbids.
    return filterEntries(value, depth, seen)
  } finally {
    seen.delete(value)
  }
}

/**
 * Redact any value. Returns `DROP` for values that must not be emitted at all.
 * Exported only through `redactFields`; the sentinel stays internal.
 */
const redactValue = (value: unknown, depth: number, seen: WeakSet<object>): Redacted | Dropped => {
  if (value === null) return null

  switch (typeof value) {
    case "string":
      return scrubSecretShapes(value)
    case "number":
      // NaN and Infinity stringify to `null`, which reads as "no value".
      return Number.isFinite(value) ? value : String(value)
    case "boolean":
      return value
    case "bigint":
      return value.toString()
    case "undefined":
    case "symbol":
    case "function":
      return DROP
    case "object":
      return redactObject(value as object, depth, seen)
    default:
      return DROP
  }
}

/**
 * The redactor's public entry point: turn a caller's fields into the object the
 * logger may emit.
 *
 * Anything that is not a keyed object has no field names to check and therefore
 * cannot be allowlisted — it yields `{}`. The one accommodation is a bare
 * `Error`, which is what a caller who ignores the type signature will pass; it
 * is placed under `err` rather than discarded, so the mistake is visible in the
 * output instead of turning into a missing log line.
 */
export const redactFields = (fields: unknown): Record<string, Redacted> => {
  if (fields === null || fields === undefined) return {}
  if (fields instanceof Error) {
    const seen = new WeakSet<object>()
    const err = redactValue(fields, 0, seen)
    return err === DROP ? {} : { err }
  }
  if (typeof fields !== "object" || Array.isArray(fields)) return {}
  return filterEntries(fields, 0, new WeakSet<object>())
}

/** Exposed for tests and for callers that need to redact a single value with
 *  the same rules the logger applies. */
export const redact = (value: unknown): Redacted | undefined => {
  const result = redactValue(value, 0, new WeakSet<object>())
  return result === DROP ? undefined : result
}
