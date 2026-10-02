'use client';

type Props = {
  onInsert: (text: string) => void;
};

const TEMPLATES = [
  { label: 'Cadastro incompleto', body: 'Olá! Para seguirmos com seu cadastro, precisamos que envie os documentos pendentes.' },
  { label: 'Dados para adiantamento', body: 'Olá! Para analisar seu pedido de adiantamento, confirme seu CPF e chave PIX cadastrados.' },
];

export function InboxRequestInfoPanel({ onInsert }: Props) {
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <h4 className="text-xs font-semibold">Solicitar informação</h4>
      {TEMPLATES.map((t) => (
        <button
          key={t.label}
          type="button"
          onClick={() => onInsert(t.body)}
          className="block w-full rounded-md border border-border bg-background/40 px-2 py-2 text-left text-xs hover:bg-sidebar-accent/60"
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
