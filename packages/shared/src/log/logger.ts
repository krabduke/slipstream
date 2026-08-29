/**
 * Structured logging: one JSON object per line, on stdout.
 *
 * Line-delimited JSON because the consumer is a log shipper, not a human — an
 * unattended trading process is read through queries ("every skip with reason
 * slippage_exceeded for this user"), and a pretty-printed multi-line format
 * makes that a parsing problem. See docs/01 §6.
 *
 * Every field a caller supplies passes through `redactFields` before it is
 * written. There is no unredacted escape hatch, no `logger.raw`, no option to
 * disable the filter for local development — a switch that turns redaction off
 * is a switch somebody eventually ships enabled.
 */
import { redactFields, type LogFields, type Redacted } from "./redact.js"

export type LogLevel = "debug" | "info" | "warn" | "error"

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const

/**
 * The envelope written around every entry.
 *
 * `time`, `level` and `msg` are produced by the logger itself and are therefore
 * absent from the allowlist: they are not caller data, and keeping them out of
 * the allowlist means a caller who passes `{ level: "debug" }` in their fields
 * cannot forge the level of their own log line. The envelope is applied after
 * redaction, so it also cannot be overwritten by a redacted field.
 */
export interface LogEntry {
  readonly time: string
  readonly level: LogLevel
  readonly msg: string
  readonly [field: string]: Redacted
}

/** Where a finished line goes. One call per line; the newline is included. */
export type LogSink = (line: string) => void

export interface Logger {
  debug(msg: string, fields?: LogFields): void
  info(msg: string, fields?: LogFields): void
  warn(msg: string, fields?: LogFields): void
  error(msg: string, fields?: LogFields): void
  /** True when a line at `level` would be emitted. For skipping expensive
   *  context construction, never for deciding what is safe to log. */
  isLevelEnabled(level: LogLevel): boolean
  /** A logger that merges `bindings` into every entry. Bindings are redacted at
   *  emit time like anything else, so a non-allowlisted binding never leaks. */
  child(bindings: LogFields): Logger
}

export interface LoggerOptions {
  /** Minimum level emitted. Default `"info"`. */
  readonly level?: LogLevel
  /** Default: a single line written to stdout. */
  readonly sink?: LogSink
  /** Injectable clock, so tests assert on output rather than on time. */
  readonly now?: () => Date
  /** Fields merged into every entry, e.g. `{ service: "engine" }`. */
  readonly bindings?: LogFields
}

const stdoutSink: LogSink = (line) => {
  process.stdout.write(line)
}

/**
 * Last-resort line for the case where a redacted entry still fails to
 * stringify. It should be unreachable — `redactFields` returns only JSON-safe
 * values — so it reports a bug rather than papering over one, and it carries no
 * caller data because the caller data is what is suspect.
 */
const serialisationFailureLine = (time: string, level: LogLevel): string =>
  `${JSON.stringify({
    time,
    level,
    msg: "log entry could not be serialised; fields were dropped",
    component: "shared/log",
  })}\n`

export const createLogger = (options: LoggerOptions = {}): Logger => {
  const minimum = LEVEL_RANK[options.level ?? "info"]
  const sink = options.sink ?? stdoutSink
  const now = options.now ?? (() => new Date())
  const bindings = options.bindings

  const emit = (level: LogLevel, msg: string, fields?: LogFields): void => {
    if (LEVEL_RANK[level] < minimum) return

    const time = now().toISOString()
    // Bindings merge first so a per-call field wins over an inherited one, and
    // both are redacted in the same pass — a binding gets no more trust than a
    // field, because it was written by the same hand.
    const merged: LogFields = bindings ? { ...bindings, ...fields } : (fields ?? {})
    const redacted = redactFields(merged)

    let line: string
    try {
      line = `${JSON.stringify({ ...redacted, time, level, msg })}\n`
    } catch {
      line = serialisationFailureLine(time, level)
    }
    sink(line)
  }

  const logger: Logger = {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
    isLevelEnabled: (level) => LEVEL_RANK[level] >= minimum,
    child: (extra) =>
      createLogger({
        ...options,
        bindings: bindings ? { ...bindings, ...extra } : extra,
      }),
  }

  return logger
}

/**
 * A logger that emits nothing. For tests and for the rare code path that must
 * accept a `Logger` but has nowhere to write.
 */
export const nullLogger: Logger = createLogger({ level: "error", sink: () => {} })
