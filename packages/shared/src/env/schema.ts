/**
 * The environment schema.
 *
 * Two rules shape everything below.
 *
 * **1. No default for anything security-relevant.** A default is a decision
 * made on the operator's behalf by someone who cannot see their deployment. For
 * a database URL, a KMS key id, a session secret, or the flag that decides
 * whether orders are real, that decision is not ours to make: the failure mode
 * of a wrong default is silent (it boots, it looks healthy, it is pointed at
 * the wrong thing) and the failure mode of a missing value is loud. Defaults
 * appear here only for tuning knobs where every possible value is safe.
 *
 * `PAPER_MODE` is required for exactly this reason. Defaulting it to `true`
 * would be the "safe" choice right up until someone's production deploy
 * silently stops trading; defaulting it to `false` needs no explanation. There
 * is no third option that does not involve guessing, so the operator says it
 * out loud.
 *
 * **2. Every problem is reported at once.** See `parseEnv` in `index.ts`.
 */
import { z } from "zod"
import { LOG_LEVELS } from "../log/logger.js"

/** A raw environment: `process.env`, a `.env` file, or a test fixture. */
export type EnvSource = Readonly<Record<string, string | undefined>>

const requiredMessage = { required_error: "is required but was not set" }

const isPostgresUrl = (value: string): boolean =>
  value.startsWith("postgres://") || value.startsWith("postgresql://")

const isRedisUrl = (value: string): boolean =>
  value.startsWith("redis://") || value.startsWith("rediss://")

export const envSchema = z.object({
  // ---- Stores. No defaults: a wrong database is worse than no database. ----
  DATABASE_URL: z
    .string(requiredMessage)
    .refine(isPostgresUrl, { message: "must be a postgres:// or postgresql:// URL" }),

  REDIS_URL: z
    .string(requiredMessage)
    .refine(isRedisUrl, { message: "must be a redis:// or rediss:// URL" }),

  // ---- Auth. ----
  /** Signs the short-lived session JWT (docs/04 §5). 32 characters is the
   *  floor, not a recommendation; generate it randomly, never type it. */
  SESSION_SECRET: z
    .string(requiredMessage)
    .min(32, { message: "must be at least 32 characters" }),

  // ---- Custody. ----
  /** Which `KeyVault` implementation the engine constructs (docs/04 §3).
   *  Required rather than defaulted to `local`, because a deployment that
   *  quietly fell back to file-based wrapping would believe it had KMS. */
  KMS_PROVIDER: z.enum(["aws", "gcp", "local"], requiredMessage),

  /** Required when `KMS_PROVIDER` is `aws` or `gcp` — see `crossFieldIssues`. */
  KMS_KEY_ID: z.string().min(1, { message: "must not be empty" }).optional(),

  /** Required when `KMS_PROVIDER` is `local`. Never generated on the fly: a
   *  silently generated master key makes yesterday's ciphertext unreadable. */
  LOCAL_MASTER_KEY: z.string().min(32, { message: "must be at least 32 characters" }).optional(),

  // ---- Trading posture. ----
  /** `true` places no real orders. Required: see the header. */
  PAPER_MODE: z
    .enum(["true", "false", "1", "0"], requiredMessage)
    .transform((value) => value === "true" || value === "1"),

  // ---- Tuning. Defaults permitted: every value here is safe. ----
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  PORT: z.coerce
    .number({ invalid_type_error: "must be a number" })
    .int({ message: "must be an integer" })
    .min(1, { message: "must be between 1 and 65535" })
    .max(65535, { message: "must be between 1 and 65535" })
    .default(3000),
})

/** Parsed, validated configuration. Everything downstream takes this; nothing
 *  downstream reads `process.env`. */
export type AppEnv = z.infer<typeof envSchema>

/** One thing wrong with one variable. */
export interface EnvIssue {
  readonly variable: string
  readonly problem: string
}

/**
 * Conditional requirements, checked outside zod on purpose.
 *
 * A `.superRefine` on the object schema only runs when the base object parsed
 * cleanly, so a missing `DATABASE_URL` would suppress the KMS check entirely
 * and the operator would fix one problem, re-run, and meet the next. Running
 * these against the raw source instead keeps the "every problem at once"
 * guarantee true no matter what else failed.
 */
export const crossFieldIssues = (source: EnvSource): readonly EnvIssue[] => {
  const issues: EnvIssue[] = []
  const provider = source["KMS_PROVIDER"]

  if (provider === "aws" || provider === "gcp") {
    if (source["KMS_KEY_ID"] === undefined) {
      issues.push({
        variable: "KMS_KEY_ID",
        problem: `is required when KMS_PROVIDER is "${provider}"`,
      })
    }
  }

  if (provider === "local" && source["LOCAL_MASTER_KEY"] === undefined) {
    issues.push({
      variable: "LOCAL_MASTER_KEY",
      problem: 'is required when KMS_PROVIDER is "local"',
    })
  }

  return issues
}
