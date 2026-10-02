import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, '../src/routes/commercial');
for (const name of fs.readdirSync(dir)) {
  if (!name.endsWith('.ts')) continue;
  const file = path.join(dir, name);
  let content = fs.readFileSync(file, 'utf8');
  if (name !== 'index.ts' && name !== 'shared.ts') {
    content = content.replaceAll("from '../", "from '../../");
    content = content.replace(/\nimport type \{ FastifyInstance \} from 'fastify';\nimport \{ commercialPre/g, '\nimport { commercialPre');
  }
  fs.writeFileSync(file, content);
  console.log('fixed', name);
}

const shared = path.join(dir, 'shared.ts');
let sharedContent = fs.readFileSync(shared, 'utf8');
sharedContent = sharedContent
  .replace('const commercialPre', 'export const commercialPre')
  .replace('const proposalPre', 'export const proposalPre');
fs.writeFileSync(shared, sharedContent);
console.log('fixed shared exports');
