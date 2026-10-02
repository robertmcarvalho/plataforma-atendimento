'use client';

import { FinancialPageContent } from '@/components/financial/FinancialPageContent';
import { useFinancialPageController } from '@/lib/financial/useFinancialPageController';

export default function FinanceiroPage() {
  const controller = useFinancialPageController();
  return <FinancialPageContent {...controller} />;
}
