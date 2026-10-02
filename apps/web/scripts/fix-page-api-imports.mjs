import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const fixes = [
  ['src/app/(app)/campaigns/page.tsx', "import { campaignsPageApi } from '@/lib/campaigns/campaignsPageApi';"],
  ['src/app/(app)/automations/page.tsx', "import { automationsPageApi } from '@/lib/automations/automationsPageApi';"],
  ['src/app/(app)/contacts/page.tsx', "import { contactsPageApi } from '@/lib/contacts/contactsPageApi';"],
  ['src/app/(app)/leaders/page.tsx', "import { cadastroPageApi } from '@/lib/cadastro/cadastroPageApi';"],
  ['src/app/(app)/leaders/new/page.tsx', "import { cadastroPageApi } from '@/lib/cadastro/cadastroPageApi';"],
  ['src/app/(app)/drivers/page.tsx', "import { cadastroPageApi } from '@/lib/cadastro/cadastroPageApi';"],
  ['src/app/(app)/drivers/new/page.tsx', "import { cadastroPageApi } from '@/lib/cadastro/cadastroPageApi';"],
  ['src/app/(app)/pharmacies/page.tsx', "import { cadastroPageApi } from '@/lib/cadastro/cadastroPageApi';"],
  ['src/app/(app)/pharmacies/new/page.tsx', "import { cadastroPageApi } from '@/lib/cadastro/cadastroPageApi';"],
  ['src/app/(app)/lider/page.tsx', "import { leaderPortalPageApi } from '@/lib/leaderPortal/leaderPortalPageApi';"],
  [
    'src/app/(app)/lider/chat/page.tsx',
    "import { leaderPortalPageApi } from '@/lib/leaderPortal/leaderPortalPageApi';\nimport { inboxPageApi } from '@/lib/inbox/inboxPageApi';",
  ],
];

for (const [rel, importBlock] of fixes) {
  const file = path.join(root, rel);
  let src = fs.readFileSync(file, 'utf8');
  if (src.includes(importBlock.split('\n')[0])) {
    console.log('ok', rel);
    continue;
  }
  src = src.replace(/^('use client';\r?\n)/, `$1\n${importBlock}\n`);
  fs.writeFileSync(file, src);
  console.log('fixed', rel);
}

// attendants leftover
for (const rel of ['src/app/(app)/pharmacies/page.tsx', 'src/app/(app)/pharmacies/new/page.tsx']) {
  const file = path.join(root, rel);
  let src = fs.readFileSync(file, 'utf8');
  const from = `(
        await api.get('/api/users/attendants', {
          params: { scope: 'workspace', include_supervisors: '1' },
        })
      ).data`;
  const to = `await cadastroPageApi.fetchAttendants({ scope: 'workspace', include_supervisors: '1' })`;
  if (src.includes(from)) {
    src = src.split(from).join(to);
    fs.writeFileSync(file, src);
    console.log('attendants', rel);
  }
}
