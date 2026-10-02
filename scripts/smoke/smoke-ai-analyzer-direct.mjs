/**
 * Smoke direto do pacote @plataforma/ai-core (sem HTTP).
 * Uso: npm run smoke:ai-analyzer-direct
 *
 * Objetivo: garantir que o runtime de IA está "chamável" quando habilitado,
 * mas permitir SKIP quando o ambiente não tem chaves/config.
 */
import fs from 'node:fs';
import path from 'node:path';

function readEnvFile(filePath) {
  const vars = {};
  if (!fs.existsSync(filePath)) return vars;
  for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    vars[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return vars;
}

// Tenta ler .env de serviços comuns (sem falhar se não existir).
const envApi = readEnvFile(path.join(process.cwd(), 'apps', 'api-service', '.env'));
const envOrchestrator = readEnvFile(path.join(process.cwd(), 'apps', 'orchestrator-service', '.env'));
const env = { ...envApi, ...envOrchestrator };

const aiEnabledRaw = process.env.AI_ANALYSIS_ENABLED ?? env.AI_ANALYSIS_ENABLED ?? '';
const aiEnabled = ['1', 'true', 'yes', 'on'].includes(String(aiEnabledRaw).trim().toLowerCase());

const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GEMINI_API_KEY || '';

if (!aiEnabled) {
  console.log('SKIP_SMOKE_AI_DISABLED — AI_ANALYSIS_ENABLED está desligado.');
  process.exit(0);
}
if (!apiKey) {
  console.log('SKIP_SMOKE_NO_GEMINI_KEY — faltam GOOGLE_API_KEY/GEMINI_API_KEY.');
  process.exit(0);
}

// @plataforma/ai-core expõe funções via dist; se o pacote não tiver build, falha cedo com mensagem clara.
let analyzeSentimentUrgency;
let predictNps;
try {
  ({ analyzeSentimentUrgency, predictNps } = await import('@plataforma/ai-core'));
} catch (e) {
  console.error(
    'Smoke ai-core falhou ao importar @plataforma/ai-core. Rode build do pacote (npm run build --workspace=packages/ai-core).',
    e?.message || e
  );
  process.exit(1);
}

try {
  const sample1 = await analyzeSentimentUrgency('Oi! Obrigado, resolveu meu problema. Pode encerrar.', apiKey);
  if (!sample1?.sentiment || !sample1?.urgency) throw new Error('Resposta inválida em analyzeSentimentUrgency.');

  const sample2 = await analyzeSentimentUrgency('Estou muito chateado. Preciso disso agora, é urgente!', apiKey);
  if (!sample2?.sentiment || !sample2?.urgency) throw new Error('Resposta inválida em analyzeSentimentUrgency (caso 2).');

  const nps = await predictNps('Cliente ficou satisfeito após ajuste no pedido. Atendimento rápido e cordial.', apiKey);
  if (typeof nps?.score !== 'number' || !Number.isFinite(nps.score) || nps.score < 0 || nps.score > 10) {
    throw new Error('NPS inválido em predictNps.');
  }

  console.log('OK: smoke ai-core direto concluído (sentimento/urgência + NPS).');
} catch (e) {
  console.error('Smoke ai-core direto falhou:', e?.message || e);
  process.exit(1);
}

