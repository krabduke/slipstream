/**
 * Tests for environment parsing.
 *
 * The load-bearing one is "reports every problem at once". Everything else here
 * defends the rule from docs/04: nothing security-relevant gets a default, and
 * no error message ever quotes the value that failed.
 *
 * `parseEnv` is pure, so these tests never touch `process.env` -- which is also
 * the property the module is built around.
 */
import { describe, expect, it } from "vitest"
import { EnvError, parseEnv } from "../env/index.js"
import type { EnvSource } from "../env/index.js"

const SECRET = "0123456789abcdef0123456789abcdef"

const valid: EnvSource = {
  DATABASE_URL: "postgres://slipstream@localhost:55432/slipstream",
  REDIS_URL: "redis://localhost:56379",
  SESSION_SECRET: SECRET,
  KMS_PROVIDER: "aws",
  KMS_KEY_ID: "arn:aws:kms:eu-west-1:1234:key/abcd",
  PAPER_MODE: "true",
}

const without = (source: EnvSource, ...keys: readonly string[]): EnvSource => {
  const out: Record<string, string | undefined> = { ...source }
  for (const key of keys) delete out[key]
  return out
}

const failure = (source: EnvSource): EnvError => {
  try {
    parseEnv(source)
  } catch (error) {
    if (error instanceof EnvError) return error
    throw error
  }
  throw new Error("expected parseEnv to throw, but it succeeded")
}

describe("parseEnv: reporting", () => {
  it("names every missing required variable in one throw, not just the first", () => {
    const error = failure({})

    expect(error.variables).toEqual(
      expect.arrayContaining([
        "DATABASE_URL",
        "REDIS_URL",
        "SESSION_SECRET",
        "KMS_PROVIDER",
        "PAPER_MODE",
      ]),
    )
    expect(error.variables).toHaveLength(5)
    for (const name of error.variables) expect(error.message).toContain(name)
    expect(error.message).toContain("5 problems")
  })

  it("reports malformed and missing variables together", () => {
    const error = failure({
      DATABASE_URL: "mysql://localhost/slipstream",
      SESSION_SECRET: "too-short",
      KMS_PROVIDER: "aws",
      KMS_KEY_ID: "arn:aws:kms:eu-west-1:1234:key/abcd",
      PAPER_MODE: "yes",
    })

    expect(error.variables).toEqual(["DATABASE_URL", "REDIS_URL", "SESSION_SECRET", "PAPER_MODE"])
    expect(error.message).toContain("must be a postgres:// or postgresql:// URL")
    expect(error.message).toContain("REDIS_URL: is required but was not set")
    expect(error.message).toContain("must be at least 32 characters")
    expect(error.message).toContain("PAPER_MODE: must be one of: true, false, 1, 0")
  })

  it("runs conditional requirements even when other fields already failed", () => {
    // The trap: a zod `.superRefine` is skipped entirely when the base object
    // fails, so a missing DATABASE_URL would hide the KMS problem and the
    // operator would fix one thing, redeploy, and meet the next.
    const error = failure({ ...without(valid, "DATABASE_URL", "KMS_KEY_ID") })

    expect(error.variables).toEqual(["DATABASE_URL", "KMS_KEY_ID"])
    expect(error.message).toContain('KMS_KEY_ID: is required when KMS_PROVIDER is "aws"')
  })

  it("never quotes the offending value back", () => {
    const leaky = "hunter2-but-far-too-short"
    const error = failure({
      ...valid,
      SESSION_SECRET: leaky,
      KMS_PROVIDER: "vault-by-hashicorp",
      PAPER_MODE: "affirmative",
    })

    expect(error.message).not.toContain(leaky)
    expect(error.message).not.toContain("vault-by-hashicorp")
    expect(error.message).not.toContain("affirmative")
    // It still says what was wrong, and what would have been right.
    expect(error.message).toContain("KMS_PROVIDER: must be one of: aws, gcp, local")
  })

  it("is an Error with a stable name, so a caller can catch it precisely", () => {
    const error = failure({})
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe("EnvError")
    expect(error.issues.length).toBe(error.variables.length)
  })
})

describe("parseEnv: no defaults for anything security-relevant", () => {
  it.each([
    ["DATABASE_URL"],
    ["REDIS_URL"],
    ["SESSION_SECRET"],
    ["KMS_PROVIDER"],
    ["PAPER_MODE"],
  ])("refuses to boot without %s", (name) => {
    const error = failure(without(valid, name))
    expect(error.variables).toEqual([name])
  })

  it("requires KMS_KEY_ID for a cloud KMS and LOCAL_MASTER_KEY for the local vault", () => {
    expect(failure(without(valid, "KMS_KEY_ID")).variables).toEqual(["KMS_KEY_ID"])
    expect(failure({ ...valid, KMS_PROVIDER: "gcp", KMS_KEY_ID: undefined }).variables).toEqual([
      "KMS_KEY_ID",
    ])

    const local = { ...without(valid, "KMS_KEY_ID"), KMS_PROVIDER: "local" }
    expect(failure(local).variables).toEqual(["LOCAL_MASTER_KEY"])
    expect(parseEnv({ ...local, LOCAL_MASTER_KEY: SECRET }).LOCAL_MASTER_KEY).toBe(SECRET)
  })

  it("treats a blank value as missing rather than as a short one", () => {
    const error = failure({ ...valid, SESSION_SECRET: "   " })
    expect(error.message).toContain("SESSION_SECRET: is required but was not set")
  })
})

describe("parseEnv: accepted configuration", () => {
  it("parses a valid environment and defaults only the tuning knobs", () => {
    expect(parseEnv(valid)).toEqual({
      DATABASE_URL: "postgres://slipstream@localhost:55432/slipstream",
      REDIS_URL: "redis://localhost:56379",
      SESSION_SECRET: SECRET,
      KMS_PROVIDER: "aws",
      KMS_KEY_ID: "arn:aws:kms:eu-west-1:1234:key/abcd",
      PAPER_MODE: true,
      NODE_ENV: "development",
      LOG_LEVEL: "info",
      PORT: 3000,
    })
  })

  it("accepts the tuning knobs when they are set", () => {
    const env = parseEnv({ ...valid, NODE_ENV: "production", LOG_LEVEL: "debug", PORT: "8080" })
    expect(env.NODE_ENV).toBe("production")
    expect(env.LOG_LEVEL).toBe("debug")
    expect(env.PORT).toBe(8080)
  })

  it("rejects a port that is not a whole number in range", () => {
    expect(failure({ ...valid, PORT: "not-a-port" }).variables).toEqual(["PORT"])
    expect(failure({ ...valid, PORT: "70000" }).variables).toEqual(["PORT"])
    expect(failure({ ...valid, PORT: "8080.5" }).variables).toEqual(["PORT"])
  })

  it("turns PAPER_MODE into a boolean and accepts both spellings", () => {
    expect(parseEnv({ ...valid, PAPER_MODE: "true" }).PAPER_MODE).toBe(true)
    expect(parseEnv({ ...valid, PAPER_MODE: "1" }).PAPER_MODE).toBe(true)
    expect(parseEnv({ ...valid, PAPER_MODE: "false" }).PAPER_MODE).toBe(false)
    expect(parseEnv({ ...valid, PAPER_MODE: "0" }).PAPER_MODE).toBe(false)
  })

  it("trims values, so a secrets mount's trailing newline is not a wrong key", () => {
    const env = parseEnv({ ...valid, SESSION_SECRET: `${SECRET}\n`, PAPER_MODE: " false " })
    expect(env.SESSION_SECRET).toBe(SECRET)
    expect(env.PAPER_MODE).toBe(false)
  })

  it("ignores unrelated variables rather than rejecting the environment", () => {
    // process.env is full of PATH, HOME and CI noise. Being strict here would
    // make the module unusable against the only source it will ever be given.
    expect(() => parseEnv({ ...valid, PATH: "/usr/bin", HOME: "/root" })).not.toThrow()
  })

  it("does not mutate the source it was given", () => {
    const source = { ...valid }
    parseEnv(source)
    expect(source).toEqual(valid)
  })
})
