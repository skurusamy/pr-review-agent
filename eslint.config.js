// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    // Browser code served from public/: ES modules, plus the globals a
    // page has that Node doesn't. Mermaid is loaded lazily from a CDN and only
    // reached as `window.mermaid` (see public/js/mermaidLoader.js).
    files: ["public/**/*.js"],
    languageOptions: {
      sourceType: "module",
      globals: {
        document: "readonly",
        window: "readonly",
        fetch: "readonly",
        Blob: "readonly",
        URL: "readonly",
        AbortController: "readonly",
        DOMException: "readonly",
        TextDecoder: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        navigator: "readonly",
        history: "readonly",
        location: "readonly",
        Event: "readonly",
        requestAnimationFrame: "readonly",
      },
    },
  },
);
