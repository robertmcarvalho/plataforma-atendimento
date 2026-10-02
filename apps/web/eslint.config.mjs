import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Pragmas até refactors grandes (Next 16 + React Compiler + TS strict gradual). Evita que `npm run lint`
      // em todo o `apps/web` falhe por dívida legada não relacionada aos ficheiros em edição.
      "@typescript-eslint/no-explicit-any": "warn",
      // Sincronizar props → estado local (inputs mascarados, modais, prefetch). Formulários /lider usam handlers.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "warn",
      "@next/next/no-img-element": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next_local/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Biblioteca QR vendored (namespace + let legado).
    "src/lib/qrcodegen.ts",
  ]),
]);

export default eslintConfig;
