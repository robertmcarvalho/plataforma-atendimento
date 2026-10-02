/** Shape returned by GET /api/contacts/:id */
export type ContactDetail = {
  id: string;
  wa_phone: string;
  display_name: string | null;
  profile_type: string;
  is_blocked?: boolean | null;
  driver_id?: string | null;
  pharmacy_id?: string | null;
  leader_id?: string | null;
  driver?: {
    id: string;
    name: string | null;
    phone?: string | null;
    city?: string | null;
    status?: string | null;
  } | null;
  pharmacy?: {
    id: string;
    trade_name: string | null;
    phone?: string | null;
    city?: string | null;
    state?: string | null;
    status?: string | null;
  } | null;
  leader?: {
    id: string;
    name: string | null;
    phone?: string | null;
    city?: string | null;
    status?: string | null;
  } | null;
  created_at: string;
};

export type ProfileType = 'driver' | 'pharmacy' | 'leader' | 'partner' | 'unknown';
