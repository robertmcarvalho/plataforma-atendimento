import { describe, expect, it } from 'vitest';
import { sidebarHrefsForRole } from './roleNav';
import { redirectForRoleOnPath } from './requireRoleForPath';

describe('sidebarHrefsForRole', () => {
  it('sales sem permissão de cadastro não vê Farmácias', () => {
    const hrefs = sidebarHrefsForRole('sales', { commercial: { view: true } });
    expect(hrefs).not.toContain('/pharmacies');
  });

  it('sales com pharmacies.view vê Farmácias', () => {
    const hrefs = sidebarHrefsForRole('sales', { pharmacies: { view: true, manage: true } });
    expect(hrefs).toContain('/pharmacies');
    expect(hrefs).not.toContain('/drivers');
  });

  it('commercial com drivers.manage vê Entregadores', () => {
    expect(sidebarHrefsForRole('commercial', { drivers: { manage: true } })).toContain('/drivers');
  });

  it('route guard libera /pharmacies para sales com permissão', () => {
    const perms = { pharmacies: { view: true } };
    expect(redirectForRoleOnPath('sales', '/pharmacies', perms)).toBeNull();
    expect(redirectForRoleOnPath('sales', '/pharmacies/abc', perms)).toBeNull();
    expect(redirectForRoleOnPath('sales', '/pharmacies', {})).not.toBeNull();
  });
});
