-- Perfil Auditor financeiro: conciliação + leitura de acertos/pagar/receber/DRE/relatórios billing

INSERT INTO public.roles (workspace_id, name, permissions)
SELECT w.id, 'financial_auditor', '{
  "billing": {"view": true, "manage": false},
  "financial": {
    "view": true,
    "manage": false,
    "approve": false,
    "export": true,
    "reconcile": true
  },
  "reports": {"view": false},
  "conversations": {},
  "pharmacies": {"view": false},
  "drivers": {"view": false},
  "leaders": {"view": false}
}'::jsonb
FROM public.workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM public.roles r WHERE r.workspace_id = w.id AND r.name = 'financial_auditor'
);
