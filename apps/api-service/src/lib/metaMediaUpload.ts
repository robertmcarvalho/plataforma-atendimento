import https from 'node:https';
import FormData from 'form-data';

type WhatsAppChannelConfig = {
  phone_number_id: string | null;
  access_token: string | null;
};

const META_UPLOAD_TIMEOUT_MS = 45_000;

function parseJsonBody<T>(data: string): T {
  try {
    return JSON.parse(data) as T;
  } catch {
    return {} as T;
  }
}

/**
 * Upload de mídia para WhatsApp Cloud API via https.request + form-data pipe.
 */
export async function uploadWhatsAppMediaToMeta(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  channel: WhatsAppChannelConfig
): Promise<{ id: string }> {
  const token = String(channel.access_token || '').trim();
  const phoneNumberId = String(channel.phone_number_id || '').trim();
  if (!token || !phoneNumberId) {
    throw new Error('Meta WhatsApp nao configurado (access_token / phone_number_id).');
  }

  const graphVersion = process.env.META_GRAPH_VERSION?.trim() || 'v21.0';
  const url = new URL(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/media`);

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', buffer, { filename, contentType: mimeType });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          ...form.getHeaders(),
        },
        timeout: META_UPLOAD_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          const json = parseJsonBody<{ id?: string; error?: { message?: string } }>(body);
          if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) {
            reject({ status: res.statusCode, detail: json });
            return;
          }
          const id = String(json.id || '').trim();
          if (!id) {
            reject(new Error('Meta nao retornou media id.'));
            return;
          }
          resolve({ id });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Upload Meta excedeu ${Math.round(META_UPLOAD_TIMEOUT_MS / 1000)}s`));
    });
    req.on('error', reject);
    form.pipe(req);
  });
}
