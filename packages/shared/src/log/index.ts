/**
 * Structured logging with an allowlist redactor.
 *
 * Start at `allowlist.ts`: the set of field names in it is the security
 * boundary, and everything else here is machinery for applying it uniformly.
 */
export { LOG_ALLOWLIST, isAllowedField } from "./allowlist.js"
export { redact, redactFields } from "./redact.js"
export type { LogFields, Redacted } from "./redact.js"
export { createLogger, nullLogger, LOG_LEVELS } from "./logger.js"
export type { Logger, LoggerOptions, LogEntry, LogLevel, LogSink } from "./logger.js"
