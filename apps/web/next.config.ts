import type { NextConfig } from "next";

// WEB_OUTPUT_STANDALONE: local opt-in. CI: Docker/Cloud Build so standalone is emitted without relying on .env.local.
const useStandalone =
  process.env.WEB_OUTPUT_STANDALONE === '1' ||
  process.env.DOCKER_BUILD === '1' ||
  process.env.CI === 'true';

const nextConfig: NextConfig = {
  transpilePackages: ['@plataforma/operational-notes'],
  // Mantemos um distDir separado para evitar lock do OneDrive/antivirus em .next/standalone
  // enquanto o servidor de prod local ainda esta rodando.
  distDir: ".next_local",
  ...(useStandalone ? { output: 'standalone' } : {}),
  experimental: {
    // Evita fork/spawn de processos no build em alguns ambientes Windows (EPERM).
    // Usa worker_threads do Node para os workers internos.
    workerThreads: true,
    // Mantem o build mais previsivel e leve em dev machines.
    cpus: 1,
  },
  typescript: {
    // Erros de tipo nao bloqueiam o build de producao
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
