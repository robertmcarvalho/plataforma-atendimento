/**
 * DANFSe via CLI Java portal-patched (`tools/xml-danfse-br` / xml-danfse-br).
 * Preferência visual alinhada à Consulta Pública; fallback fica em resolveDanfsePdfBuffer.
 */

import { spawn } from 'child_process';
import { accessSync, constants, existsSync } from 'fs';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

export type DanfseLibGenerateResult =
  | { ok: true; pdf: Buffer; source: 'xml_danfse_br' }
  | { ok: false; code: string; message: string };

const DEFAULT_JAR_CANDIDATES = [
  '/opt/danfse/xml-danfse-br-cli.jar',
  join(process.cwd(), 'vendor', 'xml-danfse-br', 'xml-danfse-br-cli.jar'),
  join(process.cwd(), 'apps', 'api-service', 'vendor', 'xml-danfse-br', 'xml-danfse-br-cli.jar'),
  join(process.cwd(), 'tools', 'xml-danfse-br', 'target', 'xml-danfse-br-cli.jar'),
  join(process.cwd(), '..', '..', 'tools', 'xml-danfse-br', 'target', 'xml-danfse-br-cli.jar'),
];

/** Flag: default ON (prefer lib). Set BILLING_DANFSE_LIB_ENABLED=false to force PDFKit/NT008. */
export function isDanfseLibEnabled(): boolean {
  const raw = process.env.BILLING_DANFSE_LIB_ENABLED?.trim().toLowerCase();
  if (raw === undefined || raw === '') return true;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export function resolveDanfseLibJarPath(): string | null {
  const fromEnv = process.env.BILLING_DANFSE_LIB_JAR?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  for (const candidate of DEFAULT_JAR_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolveDanfseJavaBin(): string {
  return process.env.BILLING_DANFSE_JAVA_BIN?.trim() || 'java';
}

function canExecuteJava(javaBin: string): boolean {
  if (javaBin === 'java') return true;
  try {
    accessSync(javaBin, constants.X_OK);
    return true;
  } catch {
    return existsSync(javaBin);
  }
}

function runJava(args: string[], timeoutMs: number): Promise<{ code: number | null; stderr: string }> {
  const javaBin = resolveDanfseJavaBin();
  return new Promise((resolve, reject) => {
    const child = spawn(javaBin, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...process.env,
        LANG: process.env.LANG || 'C.UTF-8',
        JAVA_TOOL_OPTIONS: [process.env.JAVA_TOOL_OPTIONS, '-Dfile.encoding=UTF-8']
          .filter(Boolean)
          .join(' '),
      },
    });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Timeout DANFSe lib após ${timeoutMs}ms`));
    }, timeoutMs);
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 8_000) stderr = stderr.slice(-8_000);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr: stderr.trim() });
    });
  });
}

/**
 * Gera PDF DANFSe com o fat-jar portal-patched.
 * Não passa --municipio-nome (encoding Windows / JVM); o Java resolve xLocEmi.
 */
export async function generateDanfsePdfViaLib(params: {
  nfseXml: string | Buffer;
  /** Default true (tpAmb=1 / produção Flux). */
  producao?: boolean;
  timeoutMs?: number;
}): Promise<DanfseLibGenerateResult> {
  if (!isDanfseLibEnabled()) {
    return { ok: false, code: 'LIB_DISABLED', message: 'BILLING_DANFSE_LIB_ENABLED=false' };
  }

  const jar = resolveDanfseLibJarPath();
  if (!jar) {
    return {
      ok: false,
      code: 'JAR_MISSING',
      message: 'Jar xml-danfse-br-cli não encontrado (BILLING_DANFSE_LIB_JAR / /opt/danfse).',
    };
  }

  const javaBin = resolveDanfseJavaBin();
  if (!canExecuteJava(javaBin)) {
    return { ok: false, code: 'JAVA_MISSING', message: `Java não encontrado: ${javaBin}` };
  }

  const xmlBuf = Buffer.isBuffer(params.nfseXml)
    ? params.nfseXml
    : Buffer.from(String(params.nfseXml || ''), 'utf8');
  if (!xmlBuf.length) {
    return { ok: false, code: 'MISSING_XML', message: 'XML NFS-e ausente para DANFSe lib.' };
  }

  const workDir = await mkdtemp(join(tmpdir(), 'danfse-lib-'));
  const xmlPath = join(workDir, 'nfse.xml');
  const pdfPath = join(workDir, 'danfse.pdf');
  const timeoutMs = params.timeoutMs ?? Number(process.env.BILLING_DANFSE_LIB_TIMEOUT_MS || 60_000);

  try {
    await writeFile(xmlPath, xmlBuf);
    const args = [
      '-Dfile.encoding=UTF-8',
      '-Dxmldanfse.ibge=true',
      '-jar',
      jar,
      xmlPath,
      '-o',
      pdfPath,
      '-q',
    ];
    if (params.producao !== false) args.push('--producao');
    else args.push('--homologacao');

    const { code, stderr } = await runJava(args, timeoutMs);
    if (code !== 0) {
      return {
        ok: false,
        code: 'CLI_FAILED',
        message: stderr || `xml-danfse-br exit ${code}`,
      };
    }

    const pdf = await readFile(pdfPath);
    if (pdf.length < 200 || pdf.subarray(0, 4).toString('utf8') !== '%PDF') {
      return { ok: false, code: 'INVALID_PDF', message: 'CLI não produziu PDF válido.' };
    }
    return { ok: true, pdf, source: 'xml_danfse_br' };
  } catch (err) {
    return {
      ok: false,
      code: 'LIB_ERROR',
      message: err instanceof Error ? err.message : 'Falha ao gerar DANFSe via lib',
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Smoke: jar + flag. */
export function danfseLibRuntimeReady(): { ready: boolean; jar: string | null; java: string } {
  const jar = resolveDanfseLibJarPath();
  const java = resolveDanfseJavaBin();
  return { ready: Boolean(jar && isDanfseLibEnabled()), jar, java };
}
