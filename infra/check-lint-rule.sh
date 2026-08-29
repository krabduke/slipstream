#!/bin/sh
# Proves the slipstream float-ban lint rules actually fire, and that the
# repo itself lints clean. Run: sh infra/check-lint-rule.sh
#
# Exit 0  = rules fire (>=3 slipstream errors on the fixture) AND repo lint clean.
# Exit 1  = either half is broken.
set -eu

cd "$(dirname "$0")/.."
FIXTURE="infra/fixtures/money/float-leak.ts"

# 1. The fixture MUST fail, via the slipstream rules (not a broken config).
json=$(pnpm exec eslint --no-ignore -f json "$FIXTURE" 2>/dev/null || true)
count=$(printf '%s' "$json" | node -e '
  let s = "";
  process.stdin.on("data", (d) => (s += d)).on("end", () => {
    let results;
    try { results = JSON.parse(s); } catch { console.log(-1); return; }
    const n = (results[0]?.messages ?? []).filter((m) =>
      String(m.ruleId).startsWith("slipstream/") && m.severity === 2).length;
    console.log(n);
  });
')
if [ "$count" -lt 3 ]; then
  echo "FAIL: expected >=3 slipstream errors on $FIXTURE, got $count" >&2
  printf '%s\n' "$json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{for(const r of JSON.parse(s))for(const m of r.messages)console.log(`${m.ruleId}: ${m.message}`)}catch{console.log("unparsable eslint json output")}})' >&2
  exit 1
fi
echo "PASS: float-ban rules fire on $FIXTURE ($count errors)"

# 2. The repo MUST lint clean under the same config (fixture stays ignored).
pnpm exec eslint .
echo "PASS: repo lint clean"
