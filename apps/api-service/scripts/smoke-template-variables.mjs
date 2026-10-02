import assert from 'node:assert/strict';
import {
  extractTemplateVariables,
  normalizeEmptyTemplatePlaceholders,
  resolveTemplateVariableKeys,
} from '../lib/metaTemplateSync';

assert.deepEqual(extractTemplateVariables('Oi {{1}}, sou {{2}}'), ['var_1', 'var_2']);
assert.deepEqual(extractTemplateVariables('Oi {{}}'), ['var_1']);
assert.deepEqual(extractTemplateVariables('A {{}} B {{}}'), ['var_1', 'var_2']);
assert.deepEqual(extractTemplateVariables('Olá {{nome}}'), ['nome']);
assert.equal(normalizeEmptyTemplatePlaceholders('Oi {{}}'), 'Oi {{1}}');
assert.deepEqual(
  resolveTemplateVariableKeys({ variables: [], body: 'Olá, tudo bem?\n{{}}' }),
  ['var_1']
);
assert.deepEqual(
  resolveTemplateVariableKeys({ variables: ['var_1'], body: 'x' }),
  ['var_1']
);
console.log('metaTemplateSync variable helpers OK');
