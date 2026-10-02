-- Juros (diferença de crédito) + trilha reconciliado por/em.
-- MVP: linha interest na fatura; igualdade estrita na conciliação; reconciled_by/at.

ALTER TABLE public.billing_payments
  ADD COLUMN IF NOT EXISTS reconciled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;

ALTER TABLE public.billing_bank_movements
  ADD COLUMN IF NOT EXISTS reconciled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_billing_payments_reconciled_by
  ON public.billing_payments (workspace_id, reconciled_by)
  WHERE reconciled_by IS NOT NULL;

COMMENT ON COLUMN public.billing_payments.reconciled_by IS 'Usuário que conciliou a baixa com o extrato (null = sistema/legado).';
COMMENT ON COLUMN public.billing_payments.reconciled_at IS 'Timestamp da conciliação bancária.';

-- Backfill: baixas já conciliadas sem carimbo usam created_at como aproximação.
UPDATE public.billing_payments
SET reconciled_at = COALESCE(reconciled_at, created_at)
WHERE reconciled = true
  AND reconciled_at IS NULL;

-- ---------------------------------------------------------------------------
-- Interest line on invoice (increases total_cents)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing_add_invoice_interest(
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_amount_cents integer,
  p_reason text,
  p_created_by uuid DEFAULT NULL,
  p_source_movement_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice public.billing_invoices%ROWTYPE;
  v_line public.billing_invoice_lines%ROWTYPE;
  v_order integer := 0;
  v_reason text;
BEGIN
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Valor de juros deve ser positivo.';
  END IF;

  v_reason := trim(COALESCE(p_reason, ''));
  IF char_length(v_reason) < 3 THEN
    RAISE EXCEPTION 'Motivo dos juros é obrigatório (mínimo 3 caracteres).';
  END IF;
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Motivo dos juros excede 500 caracteres.';
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
    RAISE EXCEPTION 'Não é possível lançar juros em fatura já quitada.';
  END IF;

  IF v_invoice.status = 'draft' THEN
    RAISE EXCEPTION 'Aprove a fatura antes de lançar juros.';
  END IF;

  SELECT COALESCE(MAX(line_order), 0)
    INTO v_order
  FROM public.billing_invoice_lines
  WHERE invoice_id = p_invoice_id;

  INSERT INTO public.billing_invoice_lines (
    invoice_id,
    line_order,
    description,
    quantity,
    unit_cents,
    amount_cents,
    metadata
  )
  VALUES (
    p_invoice_id,
    v_order + 1,
    'Juros / diferença de crédito',
    1,
    p_amount_cents,
    p_amount_cents,
    jsonb_build_object(
      'kind', 'interest',
      'manual_adjustment', true,
      'nfse_exclude', true,
      'reason', v_reason,
      'source_movement_id', p_source_movement_id,
      'created_by', p_created_by,
      'created_at', now()
    )
  )
  RETURNING * INTO v_line;

  UPDATE public.billing_invoices
  SET
    total_cents = total_cents + p_amount_cents,
    updated_at = now()
  WHERE id = p_invoice_id
    AND workspace_id = p_workspace_id
  RETURNING * INTO v_invoice;

  RETURN jsonb_build_object('invoice', to_jsonb(v_invoice), 'line', to_jsonb(v_line));
END;
$$;

-- ---------------------------------------------------------------------------
-- Reconcile: exact match + actor stamp
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing_reconcile_payment(
  p_workspace_id uuid,
  p_movement_id uuid,
  p_payment_id uuid,
  p_reconciled_by uuid DEFAULT NULL
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
  v_now timestamptz := now();
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
      updated_at = v_now
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
      paid_at = CASE WHEN v_paid THEN v_now ELSE paid_at END,
      updated_at = v_now
    WHERE id = v_payable.id
      AND workspace_id = p_workspace_id
    RETURNING * INTO v_payable;

    IF v_paid AND v_payable.beneficiary_type = 'driver' AND v_payable.billing_cycle_id IS NOT NULL THEN
      UPDATE public.billing_settlements
      SET status = 'paid', paid_at = v_now, updated_at = v_now
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
      bank_account_id = COALESCE(bank_account_id, v_movement.bank_account_id),
      reconciled_by = COALESCE(p_reconciled_by, reconciled_by),
      reconciled_at = v_now
  WHERE id = v_payment.id
    AND workspace_id = p_workspace_id
  RETURNING * INTO v_payment;

  UPDATE public.billing_bank_movements
  SET reconciled = true,
      billing_payment_id = v_payment.id,
      reconciled_by = COALESCE(p_reconciled_by, reconciled_by),
      reconciled_at = v_now,
      updated_at = v_now
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

-- ---------------------------------------------------------------------------
-- Register invoice payment: stamp auto-reconcile methods
-- ---------------------------------------------------------------------------
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
  v_now timestamptz := now();
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
    reconciled_by,
    reconciled_at,
    notes,
    created_by
  )
  VALUES (
    p_workspace_id,
    p_invoice_id,
    p_amount_cents,
    COALESCE(p_paid_at, v_now),
    p_payment_method::public.billing_payment_method,
    p_bank_account_id,
    v_reconciled,
    CASE WHEN v_reconciled THEN p_created_by ELSE NULL END,
    CASE WHEN v_reconciled THEN v_now ELSE NULL END,
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
      updated_at = v_now
    WHERE id = p_invoice_id
      AND workspace_id = p_workspace_id
    RETURNING * INTO v_invoice;
  END IF;

  RETURN jsonb_build_object('invoice', to_jsonb(v_invoice), 'payment', to_jsonb(v_payment));
END;
$$;

-- ---------------------------------------------------------------------------
-- Manual settle: pass actor into reconcile stamp
-- ---------------------------------------------------------------------------
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

  RETURN public.billing_reconcile_payment(p_workspace_id, p_movement_id, v_payment.id, p_created_by);
END;
$$;

-- ---------------------------------------------------------------------------
-- Atomic: interest (if needed) + replace pending baixas + settle + reconcile
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing_settle_invoice_with_interest(
  p_workspace_id uuid,
  p_movement_id uuid,
  p_invoice_id uuid,
  p_reason text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_movement public.billing_bank_movements%ROWTYPE;
  v_invoice public.billing_invoices%ROWTYPE;
  v_available integer := 0;
  v_interest integer := 0;
  v_interest_result jsonb;
  v_settle_result jsonb;
  v_pending_removed integer := 0;
  v_reason text;
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
  IF v_movement.direction <> 'credit' THEN
    RAISE EXCEPTION 'Juros + conciliação só se aplicam a entradas (crédito).';
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
  IF v_invoice.status IN ('draft', 'paid') THEN
    RAISE EXCEPTION 'Fatura inválida para conciliação com juros (status %).', v_invoice.status;
  END IF;

  -- Pending baixas on this invoice would block/overcount; replace them atomically.
  WITH deleted AS (
    DELETE FROM public.billing_payments
    WHERE workspace_id = p_workspace_id
      AND invoice_id = p_invoice_id
      AND reconciled = false
    RETURNING id
  )
  SELECT COUNT(*)::integer INTO v_pending_removed FROM deleted;

  v_available := v_invoice.total_cents - v_invoice.amount_paid_cents;
  IF v_movement.amount_cents < v_available THEN
    RAISE EXCEPTION 'Crédito (%) menor que o saldo da fatura (%). Use baixa parcial ou ajuste manual.',
      v_movement.amount_cents, v_available;
  END IF;

  v_interest := v_movement.amount_cents - v_available;
  IF v_interest > 0 THEN
    v_reason := trim(COALESCE(p_reason, ''));
    IF char_length(v_reason) < 3 THEN
      RAISE EXCEPTION 'Motivo dos juros é obrigatório quando o crédito excede o saldo.';
    END IF;
    v_interest_result := public.billing_add_invoice_interest(
      p_workspace_id,
      p_invoice_id,
      v_interest,
      v_reason,
      p_created_by,
      p_movement_id
    );
  END IF;

  v_settle_result := public.billing_manual_settle_bank_movement(
    p_workspace_id,
    p_movement_id,
    'invoice',
    p_invoice_id,
    COALESCE(
      p_notes,
      CASE
        WHEN v_interest > 0 THEN
          'Baixa com juros de diferença de crédito (' || (v_interest::numeric / 100)::text || ')'
        ELSE NULL
      END
    ),
    p_created_by
  );

  RETURN v_settle_result || jsonb_build_object(
    'interest_cents', v_interest,
    'interest_line', v_interest_result -> 'line',
    'pending_payments_removed', v_pending_removed
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.billing_add_invoice_interest(uuid, uuid, integer, text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_settle_invoice_with_interest(uuid, uuid, uuid, text, uuid, text) TO service_role;
