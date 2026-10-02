import api from '@/lib/api';

export type MembershipRoleRecord = {
  role_id: string;
  is_primary?: boolean;
  name?: string;
};

export type UserRecord = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  username?: string | null;
  is_active?: boolean;
  role_id?: string | null;
  sector_id?: string | null;
  workspace_role?: string | null;
  workspace_roles?: string[];
  membership_roles?: MembershipRoleRecord[];
  permissions?: Record<string, unknown>;
  user_sectors?: Array<{ sector_id: string; is_primary?: boolean; sectors?: { name: string } | null }>;
  roles?: { name: string } | null;
  sectors?: { name: string } | null;
  leaders?: { id: string; name: string } | null;
  last_login_at?: string | null;
  provisioned_at?: string | null;
  created_at?: string | null;
  whatsapp_queues_count?: number;
  operational_sector_labels?: string[];
};

export type RoleRecord = { id: string; name: string; permissions?: Record<string, unknown> };

export type ProvisionResult = {
  user: UserRecord;
  username: string;
  temporary_password?: string;
  email_sent: boolean;
  email_error?: string;
};

export type UserStats = {
  period_days: number;
  conversations_handled: number;
  outbound_messages: number;
  last_login_at: string | null;
  provisioned_at: string | null;
  member_since: string | null;
};

export type ChannelAssignmentRow = {
  workspace_channel_id: string;
  display_name: string | null;
  channel_type: string;
  enabled: boolean;
  sector_ids: string[];
};

export async function listUsers(): Promise<UserRecord[]> {
  const { data } = await api.get<UserRecord[]>('/api/users');
  return data || [];
}

export async function getCountsByRole(): Promise<Record<string, number>> {
  const { data } = await api.get<{ counts_by_role: Record<string, number> }>('/api/users/counts-by-role');
  return data.counts_by_role || {};
}

export async function getUser(id: string): Promise<UserRecord> {
  const { data } = await api.get<UserRecord>(`/api/users/${id}`);
  return data;
}

export async function getUserStats(id: string): Promise<UserStats> {
  const { data } = await api.get<UserStats>(`/api/users/${id}/stats`);
  return data;
}

export async function getChannelAssignments(userId: string): Promise<ChannelAssignmentRow[]> {
  const { data } = await api.get<{ channels: ChannelAssignmentRow[] }>(`/api/users/${userId}/channel-assignments`);
  return data.channels || [];
}

export async function saveChannelAssignments(
  userId: string,
  channels: Array<{ workspace_channel_id: string; enabled: boolean; sector_ids: string[] }>
): Promise<void> {
  await api.put(`/api/users/${userId}/channel-assignments`, { channels });
}

export async function resetUserPassword(
  userId: string,
  opts?: { password?: string; generate?: boolean }
): Promise<{ temporary_password?: string }> {
  const { data } = await api.post<{ ok: boolean; temporary_password?: string }>(`/api/users/${userId}/password`, opts ?? { generate: true });
  return data;
}

export async function changeMyPassword(payload: {
  current_password: string;
  new_password: string;
}): Promise<void> {
  await api.patch('/api/users/me/password', payload);
}

export async function deactivateUser(userId: string): Promise<void> {
  await api.delete(`/api/users/${userId}`);
}

export async function listRoles(): Promise<RoleRecord[]> {
  const { data } = await api.get<RoleRecord[]>('/api/roles');
  return data || [];
}

export async function updateRolePermissions(roleId: string, permissions: Record<string, unknown>): Promise<RoleRecord> {
  const { data } = await api.patch<RoleRecord>(`/api/roles/${roleId}`, { permissions });
  return data;
}

export async function provisionUser(payload: {
  name: string;
  email: string;
  phone?: string;
  role_id: string;
  sector_id?: string;
  sector_ids?: string[];
  primary_sector_id?: string;
  leader_id?: string;
  send_email?: boolean;
}): Promise<ProvisionResult> {
  const { data } = await api.post<ProvisionResult>('/api/users/provision', payload);
  return data;
}

export async function resendUserInvite(userId: string): Promise<{ username: string; temporary_password?: string }> {
  const { data } = await api.post<{ username: string; temporary_password?: string }>(`/api/users/${userId}/resend-invite`, {});
  return data;
}

export async function toggleUserActive(userId: string): Promise<void> {
  await api.patch(`/api/users/${userId}/toggle`);
}

export async function updateUser(
  userId: string,
  payload: {
    name?: string;
    phone?: string;
    role_id?: string;
    role_ids?: string[];
    primary_role_id?: string;
    sector_id?: string;
    sector_ids?: string[];
    primary_sector_id?: string;
    leader_id?: string | null;
  }
): Promise<UserRecord> {
  const { data } = await api.put<UserRecord>(`/api/users/${userId}`, payload);
  return data;
}
