import { supabase } from './supabase';
import { decryptSecret, encryptSecret } from './credentialsCrypto';

export async function readPlatformSetting<T = Record<string, unknown>>(key: string): Promise<T | null> {
  const { data, error } = await supabase.from('platform_settings').select('value').eq('key', key).maybeSingle();
  if (error) {
    if ((error.message || '').includes('platform_settings')) return null;
    throw new Error(error.message);
  }
  if (!data?.value) return null;
  return data.value as T;
}

export async function upsertPlatformSetting(key: string, value: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from('platform_settings').upsert(
    { key, value: value as never, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
  if (error) throw new Error(error.message);
}

export type SystemEmailConfig = {
  provider: 'smtp' | 'resend' | 'sendgrid';
  from_email: string;
  from_name?: string;
  smtp_host?: string;
  smtp_port?: number;
  smtp_user?: string;
  smtp_pass?: string;
  smtp_secure?: boolean;
  api_key?: string;
};

export async function getSystemEmailConfig(): Promise<SystemEmailConfig | null> {
  const raw = await readPlatformSetting<SystemEmailConfig>('system_email');
  if (!raw?.from_email) return null;
  const cfg = { ...raw };
  if (cfg.smtp_pass) cfg.smtp_pass = decryptSecret(String(cfg.smtp_pass));
  if (cfg.api_key) cfg.api_key = decryptSecret(String(cfg.api_key));
  return cfg;
}

export async function saveSystemEmailConfig(config: SystemEmailConfig): Promise<void> {
  const payload: SystemEmailConfig = { ...config };
  if (payload.smtp_pass) payload.smtp_pass = encryptSecret(payload.smtp_pass);
  if (payload.api_key) payload.api_key = encryptSecret(payload.api_key);
  await upsertPlatformSetting('system_email', payload as unknown as Record<string, unknown>);
}
