// eslint.config.js
import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";

// Import plugins directly
import pluginLit from "eslint-plugin-lit";
import pluginWc from "eslint-plugin-wc";
import pluginLitA11y from "eslint-plugin-lit-a11y";

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
      "eslint.config.js", // Add this file to prevent it from being linted with project-based rules
    ],
  },

  // 2. Base configs
  pluginJs.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  // 3. Lit and Web Component specific configs
  {
    files: ["components/**/*.ts"],
    plugins: {
      lit: pluginLit,
      wc: pluginWc,
      "lit-a11y": pluginLitA11y,
    },
    rules: {
      // Manually apply recommended rules from plugins
      ...pluginLit.configs.recommended.rules,
      ...pluginWc.configs.recommended.rules,
      // Manually list the lit-a11y recommended rules to avoid compatibility issues
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

  // 4. Project-wide rule overrides and settings
  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-floating-promises": "error",
      "no-console": ["warn", { allow: ["warn", "error", "info", "debug"] }],
    },
  },
);
