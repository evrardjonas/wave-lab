import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";

/** @type {import('eslint').Linter.Config[]} */
export default [
  { files: ["**/*.{js,mjs,cjs,ts}"] },
  { languageOptions: { globals: globals.browser } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Build output, not source - mirrors .gitignore's dist/dist-ssr/dist-publish entries. dist-publish
    // in particular is a minified bundle (see scripts/publish-sim.mjs) that previously tripped this
    // command with dozens of unrelated errors any time a publish build happened to be present locally.
    ignores: ["dist/", "dist-ssr/", "dist-publish/"],
  },
];
