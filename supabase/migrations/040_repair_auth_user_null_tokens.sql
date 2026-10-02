-- Corrige auth.users migrados via SQL com tokens NULL (Admin API: "Database error loading user").
CREATE OR REPLACE FUNCTION public.repair_auth_user_null_tokens(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
BEGIN
  UPDATE auth.users SET
    confirmation_token = COALESCE(confirmation_token, ''),
    recovery_token = COALESCE(recovery_token, ''),
    email_change_token_new = COALESCE(email_change_token_new, ''),
    email_change = COALESCE(email_change, ''),
    email_change_token_current = COALESCE(email_change_token_current, ''),
    reauthentication_token = COALESCE(reauthentication_token, ''),
    phone_change = COALESCE(phone_change, ''),
    phone_change_token = COALESCE(phone_change_token, ''),
    updated_at = now()
  WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.repair_auth_user_null_tokens(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.repair_auth_user_null_tokens(uuid) TO service_role;
