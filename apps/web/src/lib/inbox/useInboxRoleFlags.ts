export function useInboxRoleFlags(roleName: string) {
  const canStartStaffConversation =
    roleName === 'admin' ||
    roleName === 'supervisor' ||
    roleName === 'attendant' ||
    roleName === 'attendant_financeiro' ||
    roleName === 'sales' ||
    roleName === 'commercial';
  const canEditConversationTags = roleName === 'admin' || roleName === 'supervisor';
  const canDecideAdvance =
    roleName === 'admin' || roleName === 'supervisor' || roleName === 'financial';
  const isSupervisor = roleName === 'supervisor';
  const isAdmin = roleName === 'admin';
  const canFilterByAttendant = roleName === 'admin' || roleName === 'supervisor';
  const isCommercialTeam = roleName === 'sales' || roleName === 'commercial';
  const canUseSlaAlerts = roleName === 'supervisor' || roleName === 'admin';

  return {
    canStartStaffConversation,
    canEditConversationTags,
    canDecideAdvance,
    isSupervisor,
    isAdmin,
    canFilterByAttendant,
    isCommercialTeam,
    canUseSlaAlerts,
  };
}
