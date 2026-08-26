/** Wave 0 stub marker. Every call site is a worker's assignment.
 *  Stubs exist so barrels typecheck from day one and so a worker that changes
 *  a signature gets an immediate compile error instead of a merge surprise. */
export const notImplemented = (worker: string, what: string): never => {
  throw new Error(`Not implemented (${worker}): ${what}`)
}
