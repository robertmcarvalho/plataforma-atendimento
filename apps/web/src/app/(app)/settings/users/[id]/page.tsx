'use client';

import { useParams } from 'next/navigation';
import { UserDetailPanel } from '@/components/settings/users/UserDetailPanel';

export default function UserDetailPage() {
  const params = useParams();
  const id = String(params.id || '');
  if (!id) return null;
  return <UserDetailPanel userId={id} />;
}
