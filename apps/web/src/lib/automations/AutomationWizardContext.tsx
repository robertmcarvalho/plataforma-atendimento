'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { AutomationWizardState } from '@/lib/automations/useAutomationWizard';

const AutomationWizardContext = createContext<AutomationWizardState | null>(null);

export function AutomationWizardProvider({
  value,
  children,
}: {
  value: AutomationWizardState;
  children: ReactNode;
}) {
  return <AutomationWizardContext.Provider value={value}>{children}</AutomationWizardContext.Provider>;
}

export function useAutomationWizardContext(): AutomationWizardState {
  const ctx = useContext(AutomationWizardContext);
  if (!ctx) {
    throw new Error('useAutomationWizardContext must be used within AutomationWizardProvider');
  }
  return ctx;
}
