/**
 * Assinatura XMLDSig (enveloped) da DPS com certificado A1 (PFX/PKCS#12).
 * Material carregado via secret_ref → .secrets/<ref> (ou path absoluto seguro).
 */

import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import forge from 'node-forge';
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import { BILLING_NFSE_DPS_NS } from './billingNfseDpsBuilder';

export class BillingNfseSignerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingNfseSignerError';
  }
}

export type LoadedPfxMaterial = {
  privateKeyPem: string;
  certificatePem: string;
  /** PEM chain for mTLS (leaf + intermediates when present). */
  certChainPem: string;
  thumbprintSha1: string;
  subjectCn: string | null;
  validFrom: Date | null;
  validUntil: Date | null;
};

/** Safe-to-JSON cert summary — never include forge/TLS Certificate objects (issuerCertificate cycles). */
export type PfxMaterialLogMeta = {
  thumbprintSha1: string;
  subjectCn: string | null;
  validFrom: string | null;
  validUntil: string | null;
  hasPrivateKeyPem: boolean;
  hasCertificatePem: boolean;
};

/**
 * Metadata-only view for logs / tool results.
 * Do NOT JSON.stringify forge.pki.Certificate, tls.PeerCertificate, or LoadedPfxMaterial PEMs in diagnostics.
 */
export function toPfxMaterialLogMeta(material: LoadedPfxMaterial): PfxMaterialLogMeta {
  return {
    thumbprintSha1: material.thumbprintSha1,
    subjectCn: material.subjectCn,
    validFrom: material.validFrom ? material.validFrom.toISOString() : null,
    validUntil: material.validUntil ? material.validUntil.toISOString() : null,
    hasPrivateKeyPem: Boolean(material.privateKeyPem),
    hasCertificatePem: Boolean(material.certificatePem),
  };
}

function repoRootFromHere(): string {
  return path.resolve(__dirname, '../../../../');
}

function secretRefEnvSuffix(secretRef: string): string {
  return String(secretRef || '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toUpperCase();
}

/**
 * Resolve caminho do PFX a partir de secret_ref (nome simples) ou path absoluto.
 * Nunca aceita path traversal em secret_ref.
 */
export function resolvePfxPath(
  secretRef: string,
  options?: { secretsDir?: string; repoRoot?: string }
): string {
  const ref = String(secretRef || '').trim();
  if (!ref) throw new BillingNfseSignerError('secret_ref vazio.');

  if (path.isAbsolute(ref)) {
    return ref;
  }
  if (ref.includes('..') || ref.includes('/') || ref.includes('\\') || ref.includes('\0')) {
    throw new BillingNfseSignerError(
      'secret_ref inválido. Use um nome simples (ex.: billing-nfse-coop-pfx) ou path absoluto.'
    );
  }

  // Cloud Run: cada secret precisa de diretório próprio — PFX de outras entidades via env por ref.
  const fromEnv = process.env[`BILLING_NFSE_PFX_PATH_${secretRefEnvSuffix(ref)}`]?.trim();
  if (fromEnv) {
    if (!path.isAbsolute(fromEnv)) {
      throw new BillingNfseSignerError(`BILLING_NFSE_PFX_PATH_${secretRefEnvSuffix(ref)} deve ser path absoluto.`);
    }
    return fromEnv;
  }

  const secretsDir =
    options?.secretsDir ||
    process.env.BILLING_NFSE_SECRETS_DIR?.trim() ||
    path.join(options?.repoRoot || repoRootFromHere(), '.secrets');

  const candidates = [
    path.join(secretsDir, ref),
    path.join(secretsDir, `${ref}.pfx`),
    path.join(secretsDir, `${ref}.p12`),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return candidates[0];
}

export function resolvePfxPassword(secretRef: string, options?: { secretsDir?: string }): string {
  const envKey = `BILLING_NFSE_PFX_PASSWORD_${secretRefEnvSuffix(secretRef)}`;
  const fromNamed = process.env[envKey];
  if (fromNamed != null && fromNamed !== '') return fromNamed;
  if (process.env.BILLING_NFSE_PFX_PASSWORD != null && process.env.BILLING_NFSE_PFX_PASSWORD !== '') {
    return process.env.BILLING_NFSE_PFX_PASSWORD;
  }

  const secretsDir =
    options?.secretsDir ||
    process.env.BILLING_NFSE_SECRETS_DIR?.trim() ||
    path.join(repoRootFromHere(), '.secrets');
  const ref = String(secretRef || '').trim();
  const pwdCandidates = [
    path.join(secretsDir, `${ref}.password`),
    path.join(secretsDir, `${ref}.pwd`),
    path.join(secretsDir, `${ref}.pass`),
  ];
  for (const p of pwdCandidates) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').trim();
    }
  }
  return '';
}

export function pfxFileExists(secretRef: string, options?: { secretsDir?: string }): boolean {
  try {
    const p = resolvePfxPath(secretRef, options);
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function pemFromForgeCertificate(cert: forge.pki.Certificate): string {
  return forge.pki.certificateToPem(cert);
}

function subjectCnFromCert(cert: forge.pki.Certificate): string | null {
  const attrs = cert.subject?.attributes || [];
  const cn = attrs.find((a) => a.shortName === 'CN' || a.name === 'commonName');
  return cn?.value != null ? String(cn.value) : null;
}

function sha1Thumbprint(cert: forge.pki.Certificate): string {
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const md = forge.md.sha1.create();
  md.update(der);
  return md.digest().toHex().toUpperCase();
}

export function loadPfxMaterial(
  pfxPathOrSecretRef: string,
  password?: string,
  options?: { secretsDir?: string }
): LoadedPfxMaterial {
  const pfxPath = path.isAbsolute(pfxPathOrSecretRef)
    ? pfxPathOrSecretRef
    : resolvePfxPath(pfxPathOrSecretRef, options);

  if (!fs.existsSync(pfxPath)) {
    throw new BillingNfseSignerError(`PFX não encontrado: ${pfxPath}`);
  }

  const pwd =
    password !== undefined
      ? password
      : resolvePfxPassword(path.basename(pfxPath).replace(/\.(pfx|p12)$/i, ''), options);

  const binary = fs.readFileSync(pfxPath);
  const der = forge.util.createBuffer(binary.toString('binary'));
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(der);
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, pwd || '');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new BillingNfseSignerError(`Falha ao abrir PFX (senha/arquivo?): ${msg}`);
  }

  const keyBags =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ] ||
    p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ||
    [];
  const certBags =
    p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];

  const keyBag = keyBags[0];
  if (!keyBag?.key) {
    throw new BillingNfseSignerError('PFX sem chave privada.');
  }
  const privateKeyPem = forge.pki.privateKeyToPem(keyBag.key);

  const certs = certBags.map((b) => b.cert).filter(Boolean) as forge.pki.Certificate[];
  if (certs.length === 0) {
    throw new BillingNfseSignerError('PFX sem certificado.');
  }

  // Prefer leaf with matching private key.
  let leaf = certs[0];
  for (const cert of certs) {
    try {
      const publicKey = cert.publicKey as forge.pki.rsa.PublicKey;
      const privateKey = keyBag.key as forge.pki.rsa.PrivateKey;
      if (publicKey.n && privateKey.n && publicKey.n.compareTo(privateKey.n) === 0) {
        leaf = cert;
        break;
      }
    } catch {
      /* ignore */
    }
  }

  const certificatePem = pemFromForgeCertificate(leaf);
  const others = certs.filter((c) => c !== leaf).map(pemFromForgeCertificate);
  const certChainPem = [certificatePem, ...others].join('\n');

  return {
    privateKeyPem,
    certificatePem,
    certChainPem,
    thumbprintSha1: sha1Thumbprint(leaf),
    subjectCn: subjectCnFromCert(leaf),
    validFrom: leaf.validity?.notBefore || null,
    validUntil: leaf.validity?.notAfter || null,
  };
}

function findInfDpsId(xml: string): string {
  const match = xml.match(/<infDPS\b[^>]*\bId="([^"]+)"/i);
  if (!match?.[1]) {
    throw new BillingNfseSignerError('XML sem atributo Id em <infDPS>.');
  }
  return match[1];
}

function findInfPedRegId(xml: string): string {
  const match = xml.match(/<infPedReg\b[^>]*\bId="([^"]+)"/i);
  if (!match?.[1]) {
    throw new BillingNfseSignerError('XML sem atributo Id em <infPedReg>.');
  }
  return match[1];
}

/**
 * Assina o elemento infDPS (Reference URI=#Id) com XMLDSig enveloped RSA-SHA256.
 * Signature fica como irmão de infDPS (filho de DPS), conforme XSD.
 */
export function signDpsXml(unsignedXml: string, material: LoadedPfxMaterial): string {
  const dpsId = findInfDpsId(unsignedXml);
  const doc = new DOMParser().parseFromString(unsignedXml, 'text/xml');
  const parseError = doc.getElementsByTagName('parsererror')[0];
  if (parseError) {
    throw new BillingNfseSignerError(`XML DPS inválido: ${parseError.textContent || 'parse error'}`);
  }

  const sig = new SignedXml({
    privateKey: material.privateKeyPem,
    publicCert: material.certificatePem,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  });

  sig.addReference({
    xpath: `//*[local-name(.)='infDPS']`,
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    uri: `#${dpsId}`,
    isEmptyUri: false,
  });

  // Inserir Signature como último filho de DPS (irmão de infDPS).
  sig.computeSignature(unsignedXml, {
    prefix: '',
    location: {
      reference: `//*[local-name(.)='DPS' and namespace-uri(.)='${BILLING_NFSE_DPS_NS}']`,
      action: 'append',
    },
  });

  return sig.getSignedXml();
}

export function gzipBase64Xml(xml: string): string {
  const gz = gzipSync(Buffer.from(xml, 'utf8'));
  return gz.toString('base64');
}

export function signDpsXmlToGzipBase64(
  unsignedXml: string,
  material: LoadedPfxMaterial
): { signedXml: string; dpsXmlGZipB64: string } {
  const signedXml = signDpsXml(unsignedXml, material);
  return { signedXml, dpsXmlGZipB64: gzipBase64Xml(signedXml) };
}

/**
 * Assina infPedReg (evento e101101) com XMLDSig enveloped RSA-SHA256.
 * Signature fica como irmão de infPedReg (filho de pedRegEvento).
 */
export function signPedRegEventoXml(unsignedXml: string, material: LoadedPfxMaterial): string {
  const pedRegId = findInfPedRegId(unsignedXml);
  const doc = new DOMParser().parseFromString(unsignedXml, 'text/xml');
  const parseError = doc.getElementsByTagName('parsererror')[0];
  if (parseError) {
    throw new BillingNfseSignerError(
      `XML pedRegEvento inválido: ${parseError.textContent || 'parse error'}`
    );
  }

  const sig = new SignedXml({
    privateKey: material.privateKeyPem,
    publicCert: material.certificatePem,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  });

  sig.addReference({
    xpath: `//*[local-name(.)='infPedReg']`,
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    uri: `#${pedRegId}`,
    isEmptyUri: false,
  });

  sig.computeSignature(unsignedXml, {
    prefix: '',
    location: {
      reference: `//*[local-name(.)='pedRegEvento' and namespace-uri(.)='${BILLING_NFSE_DPS_NS}']`,
      action: 'append',
    },
  });

  return sig.getSignedXml();
}

export function signPedRegEventoXmlToGzipBase64(
  unsignedXml: string,
  material: LoadedPfxMaterial
): { signedXml: string; pedidoRegistroEventoXmlGZipB64: string } {
  const signedXml = signPedRegEventoXml(unsignedXml, material);
  return { signedXml, pedidoRegistroEventoXmlGZipB64: gzipBase64Xml(signedXml) };
}

/** Gera PFX autoassinado só para testes unitários (não serve na Sefin). */
export function createSelfSignedTestPfx(password = 'test', keyBits = 1024): Buffer {
  // 1024 bits: rápido em unit tests; NÃO usar em produção/Sefin.
  const keys = forge.pki.rsa.generateKeyPair(keyBits);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  const attrs = [
    { name: 'commonName', value: 'NFSE-TEST-FIXTURE' },
    { name: 'countryName', value: 'BR' },
    { name: 'organizationName', value: 'Plataforma Atendimento Test' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, {
    algorithm: '3des',
  });
  const der = forge.asn1.toDer(p12Asn1).getBytes();
  return Buffer.from(der, 'binary');
}

/** Utilitário de teste: carrega material a partir de buffer PFX. */
export function loadPfxMaterialFromBuffer(pfx: Buffer, password: string): LoadedPfxMaterial {
  const tmpDir = path.join(repoRootFromHere(), '.secrets');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, `.nfse-test-${process.pid}-${Date.now()}.pfx`);
  try {
    fs.writeFileSync(tmp, pfx);
    return loadPfxMaterial(tmp, password);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

export function hasSignatureElement(xml: string): boolean {
  return /<(?:\w+:)?Signature\b/.test(xml);
}
