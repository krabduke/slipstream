/** W1 — fixed-point decimal implementation. Contract: ./types.ts */
import { notImplemented } from "../notimpl.js"
import type { MoneyOps } from "./types.js"

const ni = (what: string) => notImplemented("W1", `money.${what}`)

export const money: MoneyOps = {
  parse: () => ni("parse"),
  fromBigInt: () => ni("fromBigInt"),
  fromInt: () => ni("fromInt"),
  format: () => ni("format"),
  display: () => ni("display"),
  add: () => ni("add"),
  sub: () => ni("sub"),
  mul: () => ni("mul"),
  div: () => ni("div"),
  neg: () => ni("neg"),
  abs: () => ni("abs"),
  cmp: () => ni("cmp"),
  eq: () => ni("eq"),
  lt: () => ni("lt"),
  lte: () => ni("lte"),
  gt: () => ni("gt"),
  gte: () => ni("gte"),
  isZero: () => ni("isZero"),
  isNegative: () => ni("isNegative"),
  min: () => ni("min"),
  max: () => ni("max"),
  rescale: () => ni("rescale"),
  quantizeToStep: () => ni("quantizeToStep"),
  bpsOf: () => ni("bpsOf"),
  diffBps: () => ni("diffBps"),
}
