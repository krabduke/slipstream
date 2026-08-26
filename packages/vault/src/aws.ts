/** W8 — aws KeyVault backend. Contract: ./types.ts */
import { notImplemented } from "@slipstream/shared/notimpl.js"
import type { KeyVault } from "./types.js"

export const createAwsKmsVault = (): KeyVault => ({
  seal: () => notImplemented("W8", "aws.seal"),
  withKey: () => notImplemented("W8", "aws.withKey"),
  rewrap: () => notImplemented("W8", "aws.rewrap"),
})
