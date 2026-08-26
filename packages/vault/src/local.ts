/** W8 — local KeyVault backend. Contract: ./types.ts */
import { notImplemented } from "@slipstream/shared/notimpl.js"
import type { KeyVault } from "./types.js"

export const createLocalFileVault = (): KeyVault => ({
  seal: () => notImplemented("W8", "local.seal"),
  withKey: () => notImplemented("W8", "local.withKey"),
  rewrap: () => notImplemented("W8", "local.rewrap"),
})
