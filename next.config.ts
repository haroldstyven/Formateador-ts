import type { NextConfig } from "next";

/**
 * El procesamiento corre en el navegador del docente, así que la aplicación se
 * exporta como estática: no hay servidor que reciba notas, y por tanto no hay
 * sitio donde puedan quedarse. Es la forma de que la promesa de `plan.md` —
 * "ningún dato sale de tu computador"— siga siendo literal y no una intención.
 */
const nextConfig: NextConfig = {
  output: "export",
  // El dominio y los adaptadores importan con extensión `.ts` explícita, que es
  // lo que exige `verbatimModuleSyntax` y lo que entienden vitest y tsc. El
  // bundler tiene que resolverla igual.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".ts": [".ts", ".tsx"],
      ".js": [".js", ".ts", ".tsx"],
    };
    return config;
  },
  turbopack: {
    resolveExtensions: [".tsx", ".ts", ".jsx", ".js", ".json"],
  },
};

export default nextConfig;
