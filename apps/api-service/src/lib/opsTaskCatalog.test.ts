import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertTaskTypeCreatable,
  mergeOpsTaskCatalog,
  mergeOpsTaskCatalogWithAutomation,
  validateOpsTaskAutomationRulesPayload,
  validateOpsTaskCatalogPayload,
} from '@plataforma/ops-task-catalog';

describe('ops-task-catalog', () => {
  it('mergeOpsTaskCatalog keeps builtins and applies overrides', () => {
    const merged = mergeOpsTaskCatalog({
      entries: [
        {
          task_type: 'driver_enrollment_prep',
          label: 'Gerar matrícula',
          builtin: true,
          enabled: false,
          manual_create: true,
          triggers: ['manual', 'leader_precadastro'],
          icon: 'IdCard',
          tone: 'warning',
          title_template: 'Gerar matrícula: {driver_name}',
        },
      ],
    });
    const entry = merged.find((e) => e.task_type === 'driver_enrollment_prep');
    assert.equal(entry?.enabled, false);
    assert.equal(merged.length, 9);
  });

  it('assertTaskTypeCreatable rejects disabled type', () => {
    const catalog = mergeOpsTaskCatalog({
      entries: [
        {
          task_type: 'driver_enrollment_prep',
          label: 'Gerar matrícula',
          builtin: true,
          enabled: false,
          manual_create: true,
          triggers: ['manual'],
          icon: 'IdCard',
          tone: 'warning',
          title_template: 'x',
        },
      ],
    });
    assert.throws(
      () => assertTaskTypeCreatable(catalog, 'driver_enrollment_prep', 'manual'),
      /desabilitado/
    );
  });

  it('assertTaskTypeCreatable rejects invalid trigger for custom', () => {
    const catalog = mergeOpsTaskCatalog({
      entries: [
        {
          task_type: 'custom_onboarding',
          label: 'Onboarding',
          builtin: false,
          enabled: true,
          manual_create: true,
          triggers: ['manual', 'mcp'],
          icon: 'ClipboardList',
          tone: 'muted',
          title_template: 'Onboarding: {driver_name}',
        },
      ],
    });
    assert.throws(
      () => assertTaskTypeCreatable(catalog, 'custom_onboarding', 'orchestrator'),
      /não permite gatilho/
    );
  });

  it('mergeOpsTaskCatalogWithAutomation adds internal_note trigger from rules', () => {
    const merged = mergeOpsTaskCatalogWithAutomation(
      {
        entries: [
          {
            task_type: 'custom_followup',
            label: 'Follow-up',
            builtin: false,
            enabled: true,
            manual_create: true,
            triggers: ['manual', 'mcp'],
            icon: 'ClipboardList',
            tone: 'muted',
            title_template: 'Follow-up: {driver_name}',
          },
        ],
      },
      [
        {
          id: 'r1',
          event: 'internal_note_pattern',
          task_type: 'custom_followup',
          enabled: true,
          pattern: 'follow',
        },
      ]
    );
    const entry = merged.find((e) => e.task_type === 'custom_followup');
    assert.ok(entry?.triggers.includes('internal_note'));
  });

  it('validateOpsTaskAutomationRulesPayload requires pattern for internal_note', () => {
    const result = validateOpsTaskAutomationRulesPayload({
      rules: [{ id: 'r1', event: 'internal_note_pattern', task_type: 'custom_x', enabled: true }],
    });
    assert.equal(result.ok, false);
  });

  it('validateOpsTaskCatalogPayload rejects invalid slug', () => {
    const result = validateOpsTaskCatalogPayload({
      entries: [{ task_type: 'BAD', label: 'X', builtin: false, enabled: true, manual_create: true, triggers: [], icon: 'x', tone: 'muted', title_template: 'x' }],
    });
    assert.equal(result.ok, false);
  });
});
