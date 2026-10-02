'use client';

import { ToolbarSelect } from '@/components/form/ToolbarSelect';
import { cn } from '@/lib/utils';

export type SettingsSectionOption = {
  value: string;
  label: string;
};

type SettingsMobileSectionPickerProps = {
  value: string;
  onChange: (value: string) => void;
  options: SettingsSectionOption[];
  className?: string;
};

/** Seletor sticky de seção para navegação em configurações no mobile. */
export function SettingsMobileSectionPicker({
  value,
  onChange,
  options,
  className,
}: SettingsMobileSectionPickerProps) {
  return (
    <div
      className={cn(
        'sticky top-0 z-10 -mx-1 mb-4 border-b border-border bg-background/95 px-1 py-3 backdrop-blur lg:hidden',
        className,
      )}
    >
      <ToolbarSelect
        value={value}
        onChange={onChange}
        fullWidth
        wideMenu
        aria-label="Seção de configurações"
        options={options}
      />
    </div>
  );
}
