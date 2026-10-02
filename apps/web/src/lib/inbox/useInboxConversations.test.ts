import { describe, expect, it } from 'vitest';
import { buildInboxConvQuery } from './useInboxConversations';
import type { InboxConvQueryFilters } from './types';

const base: InboxConvQueryFilters = {
  isSupervisor: true,
  isAdmin: false,
  folder: 'sector_all',
  priorityFilter: 'all',
  statusFilter: 'all',
  supervisorAttendanceGroup: 'all',
  supervisorAttendantId: '',
  supervisorSlaStage: '',
  supervisorSlaBucket: '',
};

describe('buildInboxConvQuery', () => {
  it('inclui attendant_id para supervisor', () => {
    const qs = buildInboxConvQuery({
      ...base,
      supervisorAttendantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    });
    expect(qs).toContain('attendant_id=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  });

  it('inclui attendant_id para admin sem isSupervisor', () => {
    const qs = buildInboxConvQuery({
      ...base,
      isSupervisor: false,
      isAdmin: true,
      supervisorAttendantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    });
    expect(qs).toContain('attendant_id=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  });

  it('prioriza attendance_group sobre status', () => {
    const qs = buildInboxConvQuery({
      ...base,
      statusFilter: 'resolved',
      supervisorAttendanceGroup: 'active',
    });
    expect(qs).toContain('attendance_group=active');
    expect(qs).not.toContain('status=resolved');
  });

  it('envia sla quando etapa e situação estão definidas', () => {
    const qs = buildInboxConvQuery({
      ...base,
      supervisorSlaStage: 'first_response',
      supervisorSlaBucket: 'breached',
    });
    expect(qs).toContain('sla_stage=first_response');
    expect(qs).toContain('sla_bucket=breached');
  });
});
