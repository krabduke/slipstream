/** W8 — gcp KeyVault backend. Contract: ./types.ts */
import { notImplemented } from "@slipstream/shared/notimpl.js"
import type { KeyVault } from "./types.js"

export const createGcpKmsVault = (): KeyVault => ({
  seal: () => notImplemented("W8", "gcp.seal"),
  withKey: () => notImplemented("W8", "gcp.withKey"),
  rewrap: () => notImplemented("W8", "gcp.rewrap"),
})
