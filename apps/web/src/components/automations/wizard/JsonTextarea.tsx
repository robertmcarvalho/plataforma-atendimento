'use client';

export function JsonTextarea({
  label,
  value,
  onChange,
  hint,
  error,
  id,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  error?: string | null;
  id: string;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="min-h-[120px] rounded-lg border border-border bg-muted/30 p-3 font-mono text-[12px] text-foreground outline-none focus:ring-2 focus:ring-primary/40"
      />
      {hint ? <span className="text-[11px] text-subtle-foreground">{hint}</span> : null}
      {error ? <span className="text-[11px] font-semibold text-destructive">{error}</span> : null}
    </label>
  );
}
