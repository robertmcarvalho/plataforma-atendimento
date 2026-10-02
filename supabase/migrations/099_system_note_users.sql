-- BUG-010: usuário técnico "Sistema" por workspace para notas automáticas.

DO $$
DECLARE
  ws RECORD;
  sys_user_id uuid;
  sys_email text;
  attendant_role_id uuid;
BEGIN
  SELECT id INTO attendant_role_id FROM public.roles WHERE name = 'attendant' LIMIT 1;

  FOR ws IN SELECT id FROM public.workspaces LOOP
    sys_email := 'sistema+' || ws.id::text || '@flux-farma.internal';

    SELECT id INTO sys_user_id FROM public.users WHERE email = sys_email LIMIT 1;

    IF sys_user_id IS NULL THEN
      INSERT INTO public.users (name, email, is_active, role_id)
      VALUES ('Sistema', sys_email, true, attendant_role_id)
      RETURNING id INTO sys_user_id;
    END IF;

    INSERT INTO public.workspace_memberships (workspace_id, user_id, role_id, is_active, is_default)
    SELECT ws.id, sys_user_id, attendant_role_id, true, false
    WHERE NOT EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.workspace_id = ws.id AND wm.user_id = sys_user_id
    );
  END LOOP;
END $$;
