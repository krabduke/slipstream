/**
 * Environment parsing: once, at startup, or not at all.
 *
 * `process.env` is read in exactly one place in this repository -- `loadEnv`
 * below. Everything else receives an `AppEnv`. That is not tidiness: an
 * environment read scattered across modules is an environment that is validated
 * nowhere, defaults inconsistently, and fails on the tenth request into a
 * deploy rather than at boot.
 *
 * When configuration is wrong, this throws before the process can do anything,
 * and the message names *every* offending variable at once. Reporting the first
 * problem only turns a two-minute fix into a five-round guessing game against a
 * deploy loop, which is how operators end up commenting out validation.
 */
import { crossFieldIssues, envSchema, type AppEnv, type EnvIssue, type EnvSource } from "./schema.js"
import type { ZodIssue } from "zod"

export type { AppEnv, EnvIssue, EnvSource } from "./schema.js"
export { envSchema } from "./schema.js"

/**
 * Thrown when the environment is unusable. Carries the offending variables
 * separately from the message so a caller can act on them without parsing
 * prose.
 */
export class EnvError extends Error {
  readonly issues: readonly EnvIssue[]
  readonly variables: readonly string[]

  constructor(issues: readonly EnvIssue[]) {
    super(formatIssues(issues))
    this.name = "EnvError"
    this.issues = issues
    this.variables = issues.map((issue) => issue.variable)
  }
}

/**
 * Values are never quoted back.
 *
 * The variable that failed validation is disproportionately likely to be the
 * one holding a secret: a `SESSION_SECRET` that is 8 characters, a
 * `LOCAL_MASTER_KEY` pasted with half of itself missing. An error message is
 * the one place that content reliably reaches a log aggregator, a terminal
 * scrollback, and a screenshot in a support thread, so it says what was wrong
 * and never what the value was.
 */
const formatIssues = (issues: readonly EnvIssue[]): string => {
  const count = issues.length === 1 ? "1 problem" : `${issues.length} problems`
  const lines = issues.map((issue) => `  - ${issue.variable}: ${issue.problem}`)
  return [
    `Invalid environment configuration (${count}):`,
    ...lines,
    "Values are omitted from this message deliberately.",
  ].join("\n")
}

/** Translate a zod issue without ever interpolating the received value. */
const describeIssue = (issue: ZodIssue): EnvIssue => {
  const variable = issue.path.map(String).join(".") || "(root)"

  if (issue.code === "invalid_enum_value") {
    return { variable, problem: `must be one of: ${issue.options.join(", ")}` }
  }
  if (issue.code === "invalid_type" && issue.received === "undefined") {
    return { variable, problem: "is required but was not set" }
  }
  return { variable, problem: issue.message }
}

/**
 * Blank is missing.
 *
 * `FOO=` in a `.env` file and an unset `FOO` mean the same thing to an
 * operator, and treating them differently produces "String must contain at
 * least 32 character(s)" where "is required but was not set" is the truth.
 * Values are trimmed for the same reason: a trailing newline picked up from a
 * secrets mount is never intentional, and an untrimmed one turns into a wrong
 * master key or an unreachable database with no visible cause.
 */
const normalise = (source: EnvSource): EnvSource => {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== "string") continue
    const trimmed = value.trim()
    if (trimmed.length > 0) out[key] = trimmed
  }
  return out
}

/**
 * Validate an environment. Pure: pass it `process.env`, a `.env` file, or a
 * fixture.
 *
 * @throws {EnvError} listing every problem found, never just the first.
 */
export const parseEnv = (source: EnvSource): AppEnv => {
  const normalised = normalise(source)
  const result = envSchema.safeParse(normalised)

  // Both passes always run, and their issues are concatenated. A zod
  // `.superRefine` would have been the obvious home for the conditional rules
  // and would have skipped them silently whenever any other field failed.
  const schemaIssues = result.success ? [] : result.error.issues.map(describeIssue)
  const conditionalIssues = crossFieldIssues(normalised)

  const seen = new Set<string>()
  const issues: EnvIssue[] = []
  for (const issue of [...schemaIssues, ...conditionalIssues]) {
    const fingerprint = `${issue.variable} ${issue.problem}`
    if (seen.has(fingerprint)) continue
    seen.add(fingerprint)
    issues.push(issue)
  }

  if (issues.length > 0) throw new EnvError(issues)
  if (!result.success) throw new EnvError([{ variable: "(root)", problem: "failed validation" }])

  return result.data
}

let cached: AppEnv | undefined

/**
 * The one sanctioned read of `process.env`. Memoised, so configuration cannot
 * change under a running process: an engine holding open leveraged positions
 * must not discover halfway through a session that it is now in paper mode.
 */
export const loadEnv = (): AppEnv => {
  cached ??= parseEnv(process.env)
  return cached
}
