import tseslint from "typescript-eslint";

/**
 * Slipstream ESLint flat config (eslint 9 / typescript-eslint 8).
 *
 * Beyond the standard typescript-eslint recommended ruleset this file
 * enforces the float ban from docs/06-roadmap.md risk #9 ("float lint ban")
 * and docs/01-architecture.md §5 ("hand-rolled fixed-point decimals, never
 * floats"):
 *
 *   - slipstream/no-float-money      parseFloat / Number.parseFloat calls and
 *                                    non-integer number literals are ERRORS in
 *                                    every money or venue source path.
 *   - slipstream/no-number-coercion  bare Number(...) coercions: ERROR in
 *                                    money paths, WARN in venue paths.
 *                                    Type-aware exemption in the money block:
 *                                    Number(bigint) can only produce an exact
 *                                    integer, so it is never flagged
 *                                    (money/ops.ts diffBps relies on this).
 *
 * Why Number() is warn-only in venue paths today: packages/venues/src/
 * polymarket/read.ts has three pre-existing integer coercions (epoch-second
 * timestamps) that are deliberate and documented. They sit in W2/W3
 * territory which this wave may not edit; the warning keeps them visible,
 * and an owner refactoring them to an explicit integer-parse helper can
 * flip the severity to error in one line below.
 *
 * Test files are exempt from the slipstream rules (assertion fixtures
 * legitimately carry decimal literals) and run no-unused-vars at warn.
 *
 * infra/fixtures/money/float-leak.ts is ignored by normal linting and is
 * linted explicitly by infra/check-lint-rule.sh to prove these rules fire.
 */

const noFloatMoney = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      parseFloat:
        "Float ban: parseFloat() must never touch money or venue values. Use the fixed-point Decimal in the shared money package.",
      numberParseFloat:
        "Float ban: Number.parseFloat() must never touch money or venue values. Use the fixed-point Decimal in the shared money package.",
      floatLiteral:
        "Float ban: non-integer number literal {{ raw }} is not allowed in money/venue paths. Scale to an integer mantissa instead.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const fn = node.callee;
        if (fn.type === "Identifier" && fn.name === "parseFloat") {
          context.report({ node, messageId: "parseFloat" });
        } else if (
          fn.type === "MemberExpression" &&
          fn.object.type === "Identifier" &&
          fn.object.name === "Number" &&
          fn.property.type === "Identifier" &&
          fn.property.name === "parseFloat"
        ) {
          context.report({ node, messageId: "numberParseFloat" });
        }
      },
      Literal(node) {
        if (typeof node.value === "number" && !Number.isInteger(node.value)) {
          context.report({
            node,
            messageId: "floatLiteral",
            data: { raw: String(node.raw ?? node.value) },
          });
        }
      },
    };
  },
};

const noNumberCoercion = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      numberCoercion:
        "Float ban: Number(...) coercion in a money/venue path. Only Number(bigint) is float-safe; parse venue strings through the fixed-point Decimal API.",
    },
  },
  create(context) {
    // Type info is available only where a typed parser is configured (the
    // money block). Without it the rule never exempts — the safe direction.
    const services = context.sourceCode.parserServices;
    const esTreeNodeToTSNodeMap = services?.esTreeNodeToTSNodeMap;
    const checker =
      esTreeNodeToTSNodeMap && services?.program ? services.program.getTypeChecker() : null;
    const tsBigIntish = 64 | 2048; // TypeFlags.BigInt | BigIntLiteral

    return {
      CallExpression(node) {
        const fn = node.callee;
        if (fn.type !== "Identifier" || fn.name !== "Number") return;
        const arg = node.arguments[0];
        if (arg && checker) {
          try {
            const tsNode = esTreeNodeToTSNodeMap.get(arg);
            if (tsNode && (checker.getTypeAtLocation(tsNode).flags & tsBigIntish) !== 0) {
              return;
            }
          } catch {
            /* untyped or exotic node — fall through and report */
          }
        }
        context.report({ node, messageId: "numberCoercion" });
      },
    };
  },
};

const slipstream = {
  rules: {
    "no-float-money": noFloatMoney,
    "no-number-coercion": noNumberCoercion,
  },
};

const MONEY_PATHS = ["packages/*/src/**/money/**", "infra/fixtures/money/**"];
const VENUE_PATHS = [
  "packages/venues/src/**",
  "packages/*/src/**/*venue*",
  "packages/*/src/**/*venue*/**",
];

export default tseslint.config(
  {
    // Repo hygiene: never lint build output or the deliberately-bad fixtures.
    ignores: ["**/dist/**", "**/.next/**", "**/coverage/**", "infra/fixtures/**"],
  },

  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [...tseslint.configs.recommended],
    rules: {
      // tsc owns no-undef for TS files.
      "no-undef": "off",
      // The repo's deliberate-unused convention is a leading underscore
      // (stub params in planner/sizing, caught errors).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },

  {
    // Generated ambient declarations (next-env.d.ts) legitimately use
    // triple-slash references.
    files: ["**/*.d.ts"],
    rules: {
      "@typescript-eslint/triple-slash-reference": "off",
    },
  },

  {
    // Float ban, part 1 — everywhere money or venue values are handled.
    files: [...MONEY_PATHS, ...VENUE_PATHS],
    plugins: { slipstream },
    rules: {
      "slipstream/no-float-money": "error",
      "slipstream/no-number-coercion": "warn", // venue default; money block upgrades
    },
  },

  {
    // Float ban, part 2 — money paths get the hard error, and the typed
    // parser that lets the rule prove Number(bigint) is float-safe.
    // projectService is scoped to exactly these files because they are the
    // only place type info is consulted; repo-root config files (vitest.
    // config.ts, apps' next.config.ts) are intentionally outside any
    // tsconfig include and must not be forced into a project.
    files: MONEY_PATHS,
    plugins: { slipstream },
    languageOptions: {
      parserOptions: {
        projectService: {
          // Real money sources live in the root tsconfig; the lint-rule
          // fixture deliberately does not — let it use the default project.
          allowDefaultProject: ["infra/fixtures/money/float-leak.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "slipstream/no-number-coercion": "error",
    },
  },

  {
    // Tests: assertion fixtures legitimately carry decimal literals and
    // half-finished helper bindings. Slipstream rules off, unused vars warn.
    files: ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "slipstream/no-float-money": "off",
      "slipstream/no-number-coercion": "off",
      "@typescript-eslint/no-unused-vars": "warn",
    },
  },
);
