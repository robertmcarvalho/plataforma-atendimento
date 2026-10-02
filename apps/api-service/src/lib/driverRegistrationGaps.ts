import { analyzeDriverRegistrationGaps } from './driverRegistrationCatalog';

export async function getDriverRegistrationGapsPublic(driverId: string, workspaceId: string) {
  const raw = await analyzeDriverRegistrationGaps(driverId, workspaceId);
  if (raw.error) return raw;

  const fields = (raw.fields as Array<{ key: string; label: string; required: boolean; filled: boolean }>) || [];
  const missing_required = fields.filter((f) => f.required && !f.filled).map((f) => ({ key: f.key, label: f.label }));
  const missing_optional = fields.filter((f) => !f.required && !f.filled).map((f) => ({ key: f.key, label: f.label }));
  const total = fields.length || 1;
  const filled = fields.filter((f) => f.filled).length;

  return {
    driver_id: driverId,
    driver_name: raw.driver_name,
    missing_required,
    missing_optional,
    completion_percent: Math.round((filled / total) * 100),
    summary_pt: raw.summary_pt,
  };
}
