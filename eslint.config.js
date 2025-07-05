// eslint.config.js
import tseslint from "typescript-eslint";
import pluginLit from "eslint-plugin-lit";
import pluginWc from "eslint-plugin-wc";
import pluginLitA11y from "eslint-plugin-lit-a11y";
import globals from "globals";

export default tseslint.config(
  // 1. Global ignores
  {
    ignores: [
      "node_modules/",
      "dist/",
      "g.txt",
      "types/generated/",
      "*.cjs",
      "llm-context/",
      "vite.config.ts",
      "postcss.config.js",
      "tailwind.config.js",
      ".kanelrc.js",
      "eslint.config.js",
    ],
  },

  // 2. Base recommended rules for TypeScript (with type checking)
  ...tseslint.configs.recommendedTypeChecked,

  // 3. Web Component and Lit rules (only apply to components/)
  {
    files: ["components/**/*.ts"],
    plugins: {
      lit: pluginLit,
      wc: pluginWc,
      "lit-a11y": pluginLitA11y,
    },
    rules: {
      ...pluginLit.configs.recommended.rules,
      ...pluginWc.configs.recommended.rules,

      // Lit A11y rules listed explicitly (avoids config conflicts)
      "lit-a11y/accessible-emoji": "error",
      "lit-a11y/alt-text": "error",
      "lit-a11y/anchor-is-valid": "error",
      "lit-a11y/aria-activedescendant-has-tabindex": "error",
      "lit-a11y/aria-attr-valid-value": "error",
      "lit-a11y/aria-attrs": "error",
      "lit-a11y/aria-role": "error",
      "lit-a11y/aria-unsupported-elements": "error",
      "lit-a11y/autocomplete-valid": "error",
      "lit-a11y/click-events-have-key-events": "error",
      "lit-a11y/iframe-title": "error",
      "lit-a11y/img-redundant-alt": "error",
      "lit-a11y/mouse-events-have-key-events": "error",
      "lit-a11y/no-access-key": "error",
      "lit-a11y/no-autofocus": "error",
      "lit-a11y/no-distracting-elements": "error",
      "lit-a11y/no-invalid-change-handler": "error",
      "lit-a11y/no-redundant-role": "error",
      "lit-a11y/role-has-required-aria-attrs": "error",
      "lit-a11y/role-supports-aria-attr": "error",
      "lit-a11y/scope": "error",
      "lit-a11y/tabindex-no-positive": "error",
      "lit-a11y/valid-lang": "error",
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  // 4. Project-wide settings & rule overrides
  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.es2021,
      },
    },
    rules: {
      // Replace deprecated rules safely
      // "no-unused-expressions": "off",
      // "@typescript-eslint/no-unused-expressions": "error",

      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-floating-promises": "error",
      "no-console": ["warn", { allow: ["warn", "error", "info", "debug"] }],
    },
  },
);
