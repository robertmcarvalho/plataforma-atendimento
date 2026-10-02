-- Correções estruturais Billing: atomicidade financeira, RLS e checks gerenciais.

ALTER TYPE public.billing_dre_line_kind ADD VALUE IF NOT EXISTS 'financial_expense';

DO $$
BEGIN
  ALTER TABLE public.billing_payments
    ADD CONSTRAINT billing_payments_single_target_check
    CHECK (
      (invoice_id IS NOT NULL AND payable_id IS NULL)
      OR (invoice_id IS NULL AND payable_id IS NOT NULL)
    ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.billing_bank_movements
    ADD CONSTRAINT billing_bank_movements_reconciled_payment_check
    CHECK ((reconciled = false) OR (billing_payment_id IS NOT NULL)) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_billing_payments_invoice_reconciled
  ON public.billing_payments (workspace_id, invoice_id, reconciled)
  WHERE invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_billing_payments_payable_reconciled
  ON public.billing_payments (workspace_id, payable_id, reconciled)
  WHERE payable_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.billing_register_invoice_payment(
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_amount_cents integer,
  p_payment_method text,
  p_bank_account_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_paid_at timestamptz DEFAULT now(),
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice public.billing_invoices%ROWTYPE;
  v_payment public.billing_payments%ROWTYPE;
  v_pending_cents integer := 0;
  v_available_cents integer := 0;
  v_reconciled boolean := false;
  v_new_paid integer := 0;
BEGIN
  IF p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Valor da baixa deve ser positivo.';
  END IF;

  SELECT *
    INTO v_invoice
  FROM public.billing_invoices
  WHERE workspace_id = p_workspace_id
    AND id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fatura não encontrada.';
  END IF;

  IF v_invoice.status = 'paid' THEN
    RAISE EXCEPTION 'Fatura já quitada.';
  END IF;

  SELECT COALESCE(SUM(amount_cents), 0)::integer
    INTO v_pending_cents
  FROM public.billing_payments
  WHERE workspace_id = p_workspace_id
    AND invoice_id = p_invoice_id
    AND reconciled = false;

  v_available_cents := v_invoice.total_cents - v_invoice.amount_paid_cents - v_pending_cents;
  IF p_amount_cents > v_available_cents THEN
    RAISE EXCEPTION 'Valor excede saldo disponível da fatura.';
  END IF;

  v_reconciled := p_payment_method IN ('cash', 'credit_card', 'other');

  INSERT INTO public.billing_payments (
    workspace_id,
    invoice_id,
    amount_cents,
    paid_at,
    payment_method,
    bank_account_id,
    reconciled,
    notes,
    created_by
  )
  VALUES (
    p_workspace_id,
    p_invoice_id,
    p_amount_cents,
    COALESCE(p_paid_at, now()),
    p_payment_method::public.billing_payment_method,
    p_bank_account_id,
    v_reconciled,
    COALESCE(p_notes, 'Baixa registrada em A receber; aguardando conciliação bancária.'),
    p_created_by
  )
  RETURNING * INTO v_payment;

  IF v_reconciled THEN
    v_new_paid := v_invoice.amount_paid_cents + p_amount_cents;
    UPDATE public.billing_invoices
    SET
      amount_paid_cents = v_new_paid,
      status = CASE WHEN v_new_paid >= total_cents THEN 'paid'::public.billing_invoice_status ELSE status END,
      updated_at = now()
    WHERE id = p_invoice_id
      AND workspace_id = p_workspace_id
    RETURNING * INTO v_invoice;
  END IF;

  RETURN jsonb_build_object('invoice', to_jsonb(v_invoice), 'payment', to_jsonb(v_payment));
END;
$$;

CREATE OR REPLACE FUNCTION public.billing_register_payable_payment(
  p_workspace_id uuid,
  p_payable_id uuid,
  p_amount_cents integer,
  p_payment_method text,
  p_legal_entity_id uuid DEFAULT NULL,
  p_bank_account_id uuid DEFAULT NULL,
  p_card_last_four text DEFAULT NULL,
  p_card_brand text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_paid_at timestamptz DEFAULT now(),
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payable public.billing_payables%ROWTYPE;
  v_payment public.billing_payments%ROWTYPE;
  v_pending_cents integer := 0;
  v_available_cents integer := 0;
  v_reconciled boolean := false;
  v_new_paid integer := 0;
  v_paid boolean := false;
BEGIN
  IF p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Valor da baixa deve ser positivo.';
  END IF;

  SELECT *
    INTO v_payable
  FROM public.billing_payables
  WHERE workspace_id = p_workspace_id
    AND id = p_payable_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Título a pagar não encontrado.';
  END IF;

  IF v_payable.payment_blocked THEN
    RAISE EXCEPTION '%', COALESCE(v_payable.block_reason, 'Pagamento bloqueado; liberação do gestor necessária.');
  END IF;

  IF v_payable.status = 'paid' THEN
    RAISE EXCEPTION 'Título a pagar já quitado.';
  END IF;

  SELECT COALESCE(SUM(amount_cents), 0)::integer
    INTO v_pending_cents
  FROM public.billing_payments
  WHERE workspace_id = p_workspace_id
    AND payable_id = p_payable_id
    AND reconciled = false;

  v_available_cents := v_payable.amount_cents - v_payable.amount_paid_cents - v_pending_cents;
  IF p_amount_cents > v_available_cents THEN
    RAISE EXCEPTION 'Valor excede saldo disponível do título.';
  END IF;

  v_reconciled := p_payment_method IN ('cash', 'credit_card', 'other');

  INSERT INTO public.billing_payments (
    workspace_id,
    payable_id,
    amount_cents,
    paid_at,
    payment_method,
    legal_entity_id,
    cost_center_id,
    bank_account_id,
    card_last_four,
    card_brand,
    reconciled,
    notes,
    created_by
  )
  VALUES (
    p_workspace_id,
    p_payable_id,
    p_amount_cents,
    COALESCE(p_paid_at, now()),
    p_payment_method::public.billing_payment_method,
    p_legal_entity_id,
    v_payable.cost_center_id,
    p_bank_account_id,
    p_card_last_four,
    p_card_brand,
    v_reconciled,
    p_notes,
    p_created_by
  )
  RETURNING * INTO v_payment;

  IF v_reconciled THEN
    v_new_paid := v_payable.amount_paid_cents + p_amount_cents;
    v_paid := v_new_paid >= v_payable.amount_cents;
    UPDATE public.billing_payables
    SET
      amount_paid_cents = v_new_paid,
      status = CASE WHEN v_paid THEN 'paid'::public.billing_payable_status ELSE status END,
      paid_at = CASE WHEN v_paid THEN now() ELSE paid_at END,
      updated_at = now()
    WHERE id = p_payable_id
      AND workspace_id = p_workspace_id
    RETURNING * INTO v_payable;

    IF v_paid AND v_payable.beneficiary_type = 'driver' AND v_payable.billing_cycle_id IS NOT NULL THEN
      UPDATE public.billing_settlements
      SET status = 'paid', paid_at = now(), updated_at = now()
      WHERE workspace_id = p_workspace_id
        AND billing_cycle_id = v_payable.billing_cycle_id
        AND driver_id = v_payable.beneficiary_id
        AND status IN ('approved');
    END IF;
  END IF;

  RETURN jsonb_build_object('payable', to_jsonb(v_payable), 'payment', to_jsonb(v_payment));
END;
$$;

CREATE OR REPLACE FUNCTION public.billing_reconcile_payment(
  p_workspace_id uuid,
  p_movement_id uuid,
  p_payment_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_movement public.billing_bank_movements%ROWTYPE;
  v_payment public.billing_payments%ROWTYPE;
  v_invoice public.billing_invoices%ROWTYPE;
  v_payable public.billing_payables%ROWTYPE;
  v_new_paid integer := 0;
  v_paid boolean := false;
BEGIN
  SELECT *
    INTO v_movement
  FROM public.billing_bank_movements
  WHERE workspace_id = p_workspace_id
    AND id = p_movement_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimento bancário não encontrado.';
  END IF;
  IF v_movement.reconciled THEN
    RAISE EXCEPTION 'Movimento bancário já conciliado.';
  END IF;

  SELECT *
    INTO v_payment
  FROM public.billing_payments
  WHERE workspace_id = p_workspace_id
    AND id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Baixa não encontrada.';
  END IF;
  IF v_payment.reconciled THEN
    RAISE EXCEPTION 'Baixa já conciliada.';
  END IF;
  IF v_payment.amount_cents <> v_movement.amount_cents THEN
    RAISE EXCEPTION 'Valor do movimento é diferente do valor da baixa.';
  END IF;

  IF v_payment.invoice_id IS NOT NULL THEN
    IF v_movement.direction <> 'credit' THEN
      RAISE EXCEPTION 'Baixas de A receber devem ser conciliadas com entradas bancárias.';
    END IF;

    SELECT *
      INTO v_invoice
    FROM public.billing_invoices
    WHERE workspace_id = p_workspace_id
      AND id = v_payment.invoice_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Fatura vinculada à baixa não encontrada.';
    END IF;

    v_new_paid := v_invoice.amount_paid_cents + v_payment.amount_cents;
    IF v_new_paid > v_invoice.total_cents THEN
      RAISE EXCEPTION 'Valor conciliado excede o total da fatura.';
    END IF;

    UPDATE public.billing_invoices
    SET
      amount_paid_cents = v_new_paid,
      status = CASE WHEN v_new_paid >= total_cents THEN 'paid'::public.billing_invoice_status ELSE status END,
      updated_at = now()
    WHERE id = v_invoice.id
      AND workspace_id = p_workspace_id
    RETURNING * INTO v_invoice;
  ELSIF v_payment.payable_id IS NOT NULL THEN
    IF v_movement.direction <> 'debit' THEN
      RAISE EXCEPTION 'Baixas de A pagar devem ser conciliadas com saídas bancárias.';
    END IF;

    SELECT *
      INTO v_payable
    FROM public.billing_payables
    WHERE workspace_id = p_workspace_id
      AND id = v_payment.payable_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Título a pagar vinculado à baixa não encontrado.';
    END IF;

    v_new_paid := v_payable.amount_paid_cents + v_payment.amount_cents;
    IF v_new_paid > v_payable.amount_cents THEN
      RAISE EXCEPTION 'Valor conciliado excede o total do título a pagar.';
    END IF;

    v_paid := v_new_paid >= v_payable.amount_cents;
    UPDATE public.billing_payables
    SET
      amount_paid_cents = v_new_paid,
      status = CASE WHEN v_paid THEN 'paid'::public.billing_payable_status ELSE status END,
      paid_at = CASE WHEN v_paid THEN now() ELSE paid_at END,
      updated_at = now()
    WHERE id = v_payable.id
      AND workspace_id = p_workspace_id
    RETURNING * INTO v_payable;

    IF v_paid AND v_payable.beneficiary_type = 'driver' AND v_payable.billing_cycle_id IS NOT NULL THEN
      UPDATE public.billing_settlements
      SET status = 'paid', paid_at = now(), updated_at = now()
      WHERE workspace_id = p_workspace_id
        AND billing_cycle_id = v_payable.billing_cycle_id
        AND driver_id = v_payable.beneficiary_id
        AND status IN ('approved');
    END IF;
  ELSE
    RAISE EXCEPTION 'Baixa sem fatura ou título a pagar vinculado.';
  END IF;

  UPDATE public.billing_payments
  SET reconciled = true,
      bank_account_id = COALESCE(bank_account_id, v_movement.bank_account_id)
  WHERE id = v_payment.id
    AND workspace_id = p_workspace_id
  RETURNING * INTO v_payment;

  UPDATE public.billing_bank_movements
  SET reconciled = true,
      billing_payment_id = v_payment.id,
      updated_at = now()
  WHERE id = v_movement.id
    AND workspace_id = p_workspace_id
  RETURNING * INTO v_movement;

  RETURN jsonb_build_object(
    'movement', to_jsonb(v_movement),
    'payment', to_jsonb(v_payment),
    'invoice', CASE WHEN v_payment.invoice_id IS NOT NULL THEN to_jsonb(v_invoice) ELSE NULL END,
    'payable', CASE WHEN v_payment.payable_id IS NOT NULL THEN to_jsonb(v_payable) ELSE NULL END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.billing_manual_settle_bank_movement(
  p_workspace_id uuid,
  p_movement_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_notes text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_movement public.billing_bank_movements%ROWTYPE;
  v_payment public.billing_payments%ROWTYPE;
  v_paid_at timestamptz;
BEGIN
  SELECT *
    INTO v_movement
  FROM public.billing_bank_movements
  WHERE workspace_id = p_workspace_id
    AND id = p_movement_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimento bancário não encontrado.';
  END IF;
  IF v_movement.reconciled THEN
    RAISE EXCEPTION 'Movimento bancário já conciliado.';
  END IF;

  v_paid_at := (v_movement.movement_date::text || 'T12:00:00.000Z')::timestamptz;

  IF p_target_type = 'invoice' THEN
    INSERT INTO public.billing_payments (
      workspace_id,
      invoice_id,
      amount_cents,
      paid_at,
      payment_method,
      bank_account_id,
      reconciled,
      notes,
      created_by
    )
    VALUES (
      p_workspace_id,
      p_target_id,
      v_movement.amount_cents,
      v_paid_at,
      'transfer',
      v_movement.bank_account_id,
      false,
      COALESCE(p_notes, 'Baixa manual pela conciliação bancária (' || COALESCE(v_movement.description, 'sem descrição') || ')'),
      p_created_by
    )
    RETURNING * INTO v_payment;
  ELSIF p_target_type = 'payable' THEN
    INSERT INTO public.billing_payments (
      workspace_id,
      payable_id,
      amount_cents,
      paid_at,
      payment_method,
      bank_account_id,
      reconciled,
      notes,
      created_by,
      cost_center_id
    )
    SELECT
      p_workspace_id,
      p_target_id,
      v_movement.amount_cents,
      v_paid_at,
      'transfer',
      v_movement.bank_account_id,
      false,
      COALESCE(p_notes, 'Baixa manual pela conciliação bancária (' || COALESCE(v_movement.description, 'sem descrição') || ')'),
      p_created_by,
      p.cost_center_id
    FROM public.billing_payables p
    WHERE p.workspace_id = p_workspace_id
      AND p.id = p_target_id
    RETURNING * INTO v_payment;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Título a pagar não encontrado.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Tipo de destino inválido.';
  END IF;

  RETURN public.billing_reconcile_payment(p_workspace_id, p_movement_id, v_payment.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_tenant_rls_policies(p_table text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  EXECUTE format('DROP POLICY IF EXISTS tenant_member_access ON public.%I', p_table);
  EXECUTE format(
    'CREATE POLICY tenant_member_access ON public.%I
       FOR ALL TO authenticated
       USING (
         EXISTS (
           SELECT 1
           FROM public.workspace_memberships wm
           WHERE wm.workspace_id = %I.workspace_id
             AND wm.user_id = auth.uid()
             AND wm.is_active = true
         )
       )
       WITH CHECK (
         EXISTS (
           SELECT 1
           FROM public.workspace_memberships wm
           WHERE wm.workspace_id = %I.workspace_id
             AND wm.user_id = auth.uid()
             AND wm.is_active = true
         )
       )',
    p_table,
    p_table,
    p_table
  );

  EXECUTE format('DROP POLICY IF EXISTS service_role_all ON public.%I', p_table);
  EXECUTE format(
    'CREATE POLICY service_role_all ON public.%I
       FOR ALL TO service_role
       USING (true)
       WITH CHECK (true)',
    p_table
  );
END;
$$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name LIKE 'billing\_%'
      AND column_name = 'workspace_id'
    GROUP BY table_name
  LOOP
    PERFORM public.ensure_tenant_rls_policies(r.table_name);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.table_name);
  END LOOP;
END $$;

CREATE OR REPLACE VIEW public.billing_financial_integrity_issues AS
SELECT
  p.workspace_id,
  'payment_without_single_target'::text AS issue_code,
  p.id::text AS entity_id,
  jsonb_build_object('invoice_id', p.invoice_id, 'payable_id', p.payable_id) AS details
FROM public.billing_payments p
WHERE (p.invoice_id IS NULL AND p.payable_id IS NULL)
   OR (p.invoice_id IS NOT NULL AND p.payable_id IS NOT NULL)
UNION ALL
SELECT
  m.workspace_id,
  'reconciled_movement_without_payment'::text AS issue_code,
  m.id::text AS entity_id,
  jsonb_build_object('bank_account_id', m.bank_account_id, 'movement_date', m.movement_date) AS details
FROM public.billing_bank_movements m
WHERE m.reconciled = true
  AND m.billing_payment_id IS NULL
UNION ALL
SELECT
  i.workspace_id,
  'invoice_total_lines_mismatch'::text AS issue_code,
  i.id::text AS entity_id,
  jsonb_build_object('invoice_total_cents', i.total_cents, 'lines_total_cents', COALESCE(SUM(l.amount_cents), 0)) AS details
FROM public.billing_invoices i
LEFT JOIN public.billing_invoice_lines l ON l.invoice_id = i.id
GROUP BY i.workspace_id, i.id, i.total_cents
HAVING i.total_cents <> COALESCE(SUM(l.amount_cents), 0);

