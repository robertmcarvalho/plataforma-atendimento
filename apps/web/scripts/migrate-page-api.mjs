import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function migrate(rel, importLines, subs) {
  const file = path.join(root, rel);
  let src = fs.readFileSync(file, 'utf8');
  if (!src.includes("import api from '@/lib/api'")) {
    console.warn('skip (no api import):', rel);
    return;
  }
  src = src.replace(/import api from '@\/lib\/api';\r?\n?/, '');
  for (const line of importLines) {
    if (!src.includes(line)) {
      src = src.replace(/^('use client';\r?\n)/, `$1\n${line}\n`);
    }
  }
  for (const [from, to] of subs) {
    if (src.includes(from)) src = src.split(from).join(to);
  }
  fs.writeFileSync(file, src);
  const n = (src.match(/api\.(get|post|put|patch|delete)/g) || []).length;
  console.log(rel, '→ remaining:', n);
}

const cadastro = "import { cadastroPageApi } from '@/lib/cadastro/cadastroPageApi';";
const leader = "import { leaderPortalPageApi } from '@/lib/leaderPortal/leaderPortalPageApi';";

migrate('src/app/(app)/campaigns/page.tsx', ["import { campaignsPageApi } from '@/lib/campaigns/campaignsPageApi';"], [
  ["(await api.get('/api/campaigns')).data", 'await campaignsPageApi.list()'],
  ["(await api.get('/api/templates/list/approved')).data", 'await campaignsPageApi.listApprovedTemplates()'],
  ["await api.post('/api/campaigns', body)", 'await campaignsPageApi.create(body)'],
  ['await api.patch(`/api/campaigns/${id}/pause`)', 'await campaignsPageApi.pause(id)'],
  ['await api.patch(`/api/campaigns/${id}/resume`)', 'await campaignsPageApi.resume(id)'],
  ['await api.post(`/api/campaigns/${id}/dispatch`)', 'await campaignsPageApi.dispatch(id)'],
]);

migrate('src/app/(app)/automations/page.tsx', ["import { automationsPageApi } from '@/lib/automations/automationsPageApi';"], [
  ["(await api.get('/api/automations')).data", 'await automationsPageApi.list()'],
  ["(await api.get('/api/templates/list/approved')).data", 'await automationsPageApi.listApprovedTemplates()'],
  ["(await api.get('/api/mcp/tools')).data", 'await automationsPageApi.listMcpTools()'],
  ['(await api.get(`/api/automations/${runsRule!.id}/runs`)).data', 'await automationsPageApi.listRuns(runsRule!.id)'],
  ["await api.post('/api/automations', body)", 'await automationsPageApi.create(body)'],
  ['await api.patch(`/api/automations/${rule.id}/toggle`)', 'await automationsPageApi.toggle(rule.id)'],
  ['await api.post(`/api/automations/${rule.id}/run`, { context: {} })', 'await automationsPageApi.run(rule.id, {})'],
]);

migrate('src/app/(app)/contacts/page.tsx', ["import { contactsPageApi } from '@/lib/contacts/contactsPageApi';"], [
  ["const res = await api.get('/api/contacts', { params })", 'const res = await contactsPageApi.list(params)'],
  ["(await api.get('/api/drivers')).data", 'await contactsPageApi.fetchDrivers()'],
  ["(await api.get('/api/pharmacies')).data", 'await contactsPageApi.fetchPharmacies()'],
  ["(await api.get('/api/leaders')).data", 'await contactsPageApi.fetchLeaders()'],
  ['await api.put(`/api/contacts/${editing.id}`, payload)', 'await contactsPageApi.update(editing.id, payload)'],
  ["await api.post('/api/contacts', payload)", 'await contactsPageApi.create(payload)'],
  ['await api.patch(`/api/contacts/${c.id}/block`, { blocked: !c.is_blocked })', 'await contactsPageApi.toggleBlock(c.id, !c.is_blocked)'],
]);

migrate('src/app/(app)/leaders/[id]/page.tsx', [cadastro], [
  ['(await api.get(`/api/leaders/${id}`)).data', 'await cadastroPageApi.fetchLeader(id)'],
]);

migrate('src/app/(app)/drivers/[id]/page.tsx', [cadastro], [
  ['(await api.get(`/api/drivers/${id}`)).data', 'await cadastroPageApi.fetchDriver(id)'],
]);

migrate('src/app/(app)/pharmacies/[id]/page.tsx', [cadastro], [
  ['(await api.get(`/api/pharmacies/${id}`)).data', 'await cadastroPageApi.fetchPharmacy(id)'],
  ["(await api.get('/api/pharmacies/summary')).data", 'await cadastroPageApi.fetchPharmaciesSummary()'],
]);

migrate('src/app/(app)/platform/settings/page.tsx', ["import { platformPageApi } from '@/lib/platform/platformPageApi';"], [
  ["(await api.get<SystemEmail>('/api/platform/settings/system-email')).data", 'await platformPageApi.fetchSystemEmail()'],
  ["(await api.get<{ items: DeliveryLogRow[] }>('/api/platform/email-delivery-log?limit=40')).data.items", 'await platformPageApi.fetchEmailDeliveryLog(40)'],
  ["await api.put('/api/platform/settings/system-email', {", 'await platformPageApi.putSystemEmail({'],
]);

migrate('src/app/(app)/settings/mcp-tools/page.tsx', ["import { settingsPageApi } from '@/lib/settings/settingsPageApi';"], [
  ["(await api.get('/api/mcp/tools')).data", 'await settingsPageApi.fetchMcpTools()'],
  ["(await api.get('/api/settings')).data", 'await settingsPageApi.fetchSettings()'],
  [`await api.put('/api/settings', {
        key: 'mcp_tools_governance',
        value: model,
      })`, `await settingsPageApi.putSetting('mcp_tools_governance', model)`],
  [`await api.put('/api/settings', {
        key: 'mcp_rollout_config',
        value: rollout,
      })`, `await settingsPageApi.putSetting('mcp_rollout_config', rollout)`],
]);

for (const rel of [
  'src/app/(app)/lider/page.tsx',
  'src/app/(app)/lider/desligamento/page.tsx',
  'src/app/(app)/lider/pre-cadastro/page.tsx',
  'src/app/(app)/lider/entregadores/page.tsx',
  'src/app/(app)/lider/farmacias/page.tsx',
  'src/app/(app)/lider/faltas/page.tsx',
]) {
  migrate(rel, [leader], [
    ["(await api.get('/api/leader-portal/stats')).data", 'await leaderPortalPageApi.fetchStats()'],
    ["(await api.get('/api/leader-portal/document-alerts')).data", 'await leaderPortalPageApi.fetchDocumentAlerts()'],
    ["(await api.get('/api/leader-portal/pharmacies')).data", 'await leaderPortalPageApi.fetchPharmacies()'],
    ["(await api.get('/api/leader-portal/drivers')).data", 'await leaderPortalPageApi.fetchDrivers()'],
    ["(await api.get('/api/leader-portal/dashboard')).data", 'await leaderPortalPageApi.fetchDashboard()'],
    ["(await api.get('/api/leader-portal/pre-registrations')).data", 'await leaderPortalPageApi.fetchPreRegistrations()'],
    ["(await api.get('/api/leader-portal/termination-requests')).data", 'await leaderPortalPageApi.fetchTerminationRequests()'],
    ['(await api.post(\'/api/leader-portal/pre-registrations\', payload)).data', 'await leaderPortalPageApi.createPreRegistration(payload)'],
    ['(await api.post(\'/api/leader-portal/termination-requests\', payload)).data', 'await leaderPortalPageApi.createTerminationRequest(payload)'],
  ]);
}

migrate('src/app/(app)/lider/chat/page.tsx', [
  leader,
  "import { inboxPageApi } from '@/lib/inbox/inboxPageApi';",
], [
  ["(await api.get('/api/leader-portal/me')).data", 'await leaderPortalPageApi.fetchMe()'],
  ["(await api.get('/api/leader-portal/stats')).data", 'await leaderPortalPageApi.fetchStats()'],
  ["(await api.get('/api/conversations')).data.data", '(await inboxPageApi.listConversations()).data'],
  ['(await api.get(`/api/conversations/${selectedId}`)).data', 'await inboxPageApi.fetchConversation(selectedId)'],
  ["await api.post('/api/messages/send', {", 'await inboxPageApi.sendMessage({'],
]);

migrate('src/app/(app)/leaders/page.tsx', [cadastro], [
  ['(await api.get(`/api/leaders/${leaderId}`)).data', 'await cadastroPageApi.fetchLeader(leaderId)'],
  ["(await api.get('/api/leaders/summary', { params })).data", 'await cadastroPageApi.fetchLeadersSummary(params)'],
  ['if (editing) await api.put(`/api/leaders/${editing.id}`, payload);', 'if (editing) await cadastroPageApi.updateLeader(editing.id, payload);'],
  ['else await api.post(\'/api/leaders\', payload);', 'else await cadastroPageApi.createLeader(payload);'],
  ['await api.put(`/api/leaders/${l.id}`, { status: l.status === \'active\' ? \'inactive\' : \'active\' });', 'await cadastroPageApi.patchLeaderStatus(l.id, l.status === \'active\' ? \'inactive\' : \'active\');'],
]);

migrate('src/app/(app)/leaders/new/page.tsx', [cadastro], [
  ['(await api.get(`/api/leaders/${editId}`)).data', 'await cadastroPageApi.fetchLeader(editId)'],
  ['? ((await api.put(`/api/leaders/${editId}`, payload)).data as SavedLeader)', '? (await cadastroPageApi.updateLeader(editId, payload) as SavedLeader)'],
  [': ((await api.post(\'/api/leaders\', payload)).data as SavedLeader)', ': (await cadastroPageApi.createLeader(payload) as SavedLeader)'],
]);

migrate('src/app/(app)/drivers/page.tsx', [cadastro], [
  ["const res = await api.get('/api/drivers', { params })", 'const res = await cadastroPageApi.fetchDrivers(params)'],
  ['await api.put(`/api/drivers/${d.id}`, { status: next });', 'await cadastroPageApi.patchDriverStatus(d.id, next);'],
]);

// pharmacies/page.tsx and new/page.tsx - common patterns
const pharmacySubs = [
  ["(await api.get('/api/pharmacies/summary')).data", 'await cadastroPageApi.fetchPharmaciesSummary()'],
  ["(await api.get('/api/leaders', { params: { status: 'active' } })).data", "await cadastroPageApi.fetchLeaders({ status: 'active' })"],
  ["(await api.get('/api/sectors')).data", 'await cadastroPageApi.fetchSectors()'],
  [`await api.get('/api/users/attendants', {
          params: { status: 'active' },
        })`, `cadastroPageApi.fetchAttendants({ status: 'active' })`],
  ["(await api.get('/api/drivers', { params: { status: 'active' } })).data", "await cadastroPageApi.fetchDrivers({ status: 'active' })"],
  ["(await api.get('/api/geo/states')).data", 'await cadastroPageApi.fetchGeoStates()'],
  ['(await api.get(`/api/geo/states/${encodeURIComponent(formState)}/cities`)).data', 'await cadastroPageApi.fetchGeoCities(formState)'],
];

for (const rel of ['src/app/(app)/pharmacies/page.tsx', 'src/app/(app)/pharmacies/new/page.tsx']) {
  const extra = rel.includes('/new/') ? [
    ['(await api.get(`/api/pharmacies/${activePharmacyId}`)).data', 'await cadastroPageApi.fetchPharmacy(activePharmacyId)'],
    ['await api.put(`/api/pharmacies/${editId}`, payload);', 'await cadastroPageApi.updatePharmacy(editId, payload);'],
    ['const created = (await api.post(\'/api/pharmacies\', payload)).data', 'const created = await cadastroPageApi.createPharmacy(payload)'],
    ['await api.post(`/api/drivers/${linkDriverId}/pharmacies`, { pharmacy_id: activePharmacyId, is_primary: Boolean(linkPrimary) });', 'await cadastroPageApi.linkDriverPharmacy(linkDriverId, { pharmacy_id: activePharmacyId, is_primary: Boolean(linkPrimary) });'],
    ['await api.delete(`/api/drivers/${driverId}/pharmacies/${activePharmacyId}`);', 'await cadastroPageApi.unlinkDriverPharmacy(driverId, activePharmacyId);'],
  ] : [
    ['(await api.get(`/api/pharmacies/${editingId}`)).data', 'await cadastroPageApi.fetchPharmacy(editingId)'],
    ['(await api.get(`/api/pharmacies/${activeDetailId}`)).data', 'await cadastroPageApi.fetchPharmacy(activeDetailId)'],
    ['if (editingId) await api.put(`/api/pharmacies/${editingId}`, payload);', 'if (editingId) await cadastroPageApi.updatePharmacy(editingId, payload);'],
    ['else await api.post(\'/api/pharmacies\', payload);', 'else await cadastroPageApi.createPharmacy(payload);'],
    ['await api.delete(`/api/pharmacies/${p.id}`);', 'await cadastroPageApi.deletePharmacy(p.id);'],
    ['await api.post(`/api/drivers/${linkDriverId}/pharmacies`, { pharmacy_id: pharmacyId, is_primary: linkPrimary });', 'await cadastroPageApi.linkDriverPharmacy(linkDriverId, { pharmacy_id: pharmacyId, is_primary: linkPrimary });'],
    ['await api.delete(`/api/drivers/${driverId}/pharmacies/${pharmacyId}`);', 'await cadastroPageApi.unlinkDriverPharmacy(driverId, pharmacyId);'],
  ];
  migrate(rel, [cadastro], [...pharmacySubs, ...extra]);
}

migrate('src/app/(app)/drivers/new/page.tsx', [cadastro], [
  ["(await api.get('/api/geo/states')).data", 'await cadastroPageApi.fetchGeoStates()'],
  ['(await api.get(`/api/geo/states/${encodeURIComponent(formState)}/cities`)).data', 'await cadastroPageApi.fetchGeoCities(formState)'],
  ["(await api.get('/api/pharmacies', { params: { status: 'active' } })).data", "await cadastroPageApi.fetchPharmacies({ status: 'active' })"],
  ['(await api.get(`/api/drivers/${editId}`)).data', 'await cadastroPageApi.fetchDriver(editId)'],
  ['? ((await api.put(`/api/drivers/${editId}`, payload)).data as ApiDriver)', '? (await cadastroPageApi.updateDriver(editId, payload) as ApiDriver)'],
  [': ((await api.post(\'/api/drivers\', payload)).data as ApiDriver)', ': (await cadastroPageApi.createDriver(payload) as ApiDriver)'],
  ['await api.delete(`/api/drivers/${saved.id}/pharmacies/${pid}`)', 'await cadastroPageApi.unlinkDriverPharmacy(saved.id, pid)'],
  ['await api.post(`/api/drivers/${saved.id}/pharmacies`, { pharmacy_id: primary, is_primary: true })', 'await cadastroPageApi.linkDriverPharmacy(saved.id, { pharmacy_id: primary, is_primary: true })'],
  ['await api.post(`/api/drivers/${saved.id}/pharmacies`, { pharmacy_id: pid, is_primary: false })', 'await cadastroPageApi.linkDriverPharmacy(saved.id, { pharmacy_id: pid, is_primary: false })'],
]);
