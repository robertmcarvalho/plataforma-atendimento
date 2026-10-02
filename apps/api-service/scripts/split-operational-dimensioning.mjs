import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'src/lib/commercial/operationalDimensioning.ts');
const lines = fs.readFileSync(src, 'utf8').split(/\r?\n/);
const slice = (a, b) => lines.slice(a - 1, b).join('\n');

const corePath = path.join(root, 'src/lib/commercial/operationalDimensioningCore.ts');
let core = slice(1, 1162);
core = core.replace(
  '/**\n * Motor de dimensionamento operacional e comercial para farmácias.\n * Função pura — parâmetros injetados via CommercialMotorConfig.\n */',
  `/**
 * Motor de dimensionamento operacional — funções puras (sem I/O de rede ou banco).
 * Testável de forma independente; ver operationalDimensioningCore.test.ts.
 */`,
);
core = core.replace('function parseHorario(', 'export function parseHorario(');
core = core.replace('function formatHorario(', 'export function formatHorario(');

const adapter = `/**
 * Adaptadores de input (lead comercial → DimensionamentoInput) e re-export do core.
 */

export * from './operationalDimensioningCore';

import {
  DEFAULT_ESCALA_OPERACIONAL,
  type CidadePerfil,
  type CommercialMotorConfig,
} from './commercialMotorConfigCore';
import { resolveFinanceiroParaLead } from './commercialMotorConfigCore';
import {
  DimensionamentoValidationError,
  formatHorario,
  parseHorario,
  type DimensionamentoInput,
} from './operationalDimensioningCore';

${slice(1164, 1325)}
`;

fs.writeFileSync(corePath, `${core}\n`);
fs.writeFileSync(src, `${adapter}\n`);
console.log('wrote operationalDimensioningCore.ts and operationalDimensioning.ts');
