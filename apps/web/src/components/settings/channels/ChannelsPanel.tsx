'use client';

import { useState } from 'react';
import { Camera, Mail, MessageSquare, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmailChannelPanel } from './EmailChannelPanel';
import { LlmWorkspaceChannelPanel } from './LlmWorkspaceChannelPanel';
import { SocialChannelManager } from './SocialChannelManager';
import type { SectorOption } from '@/lib/integrations/channelsApi';
import { OperationalContextBar } from '@/components/operational/OperationalContextBar';

type Tab = 'whatsapp' | 'instagram' | 'email' | 'llm';

function ChannelTab({
  id,
  current,
  onClick,
  icon,
  label,
  color,
}: {
  id: Tab;
  current: Tab;
  onClick: (t: Tab) => void;
  icon: React.ReactNode;
  label: string;
  color: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors',
        current === id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-sidebar-accent/60'
      )}
    >
      <span className={current === id ? color : ''}>{icon}</span> {label}
    </button>
  );
}

export function ChannelsPanel({ isAdmin = false, sectors }: { isAdmin?: boolean; sectors: SectorOption[] }) {
  const [tab, setTab] = useState<Tab>('whatsapp');

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Credenciais por workspace — canais de mensagem (Meta, e-mail), IA / LLM e webhooks consumidos pela API e serviços.
      </p>
      <OperationalContextBar
        className="rounded-xl border border-border"
        channelTypes={['whatsapp', 'instagram', 'email', 'webchat']}
        note="Contexto usado pelas telas operacionais"
      />
      <div className="flex items-center gap-1 rounded-xl border border-border bg-background p-1">
        <ChannelTab
          id="whatsapp"
          current={tab}
          onClick={setTab}
          icon={<MessageSquare className="h-3.5 w-3.5" />}
          label="WhatsApp"
          color="text-channel-whatsapp"
        />
        <ChannelTab
          id="instagram"
          current={tab}
          onClick={setTab}
          icon={<Camera className="h-3.5 w-3.5" />}
          label="Instagram"
          color="text-channel-instagram"
        />
        <ChannelTab
          id="email"
          current={tab}
          onClick={setTab}
          icon={<Mail className="h-3.5 w-3.5" />}
          label="E-mail"
          color="text-channel-email"
        />
        <ChannelTab
          id="llm"
          current={tab}
          onClick={setTab}
          icon={<Sparkles className="h-3.5 w-3.5" />}
          label="IA / LLM"
          color="text-primary"
        />
      </div>

      {tab === 'whatsapp' && <SocialChannelManager kind="whatsapp" isAdmin={isAdmin} sectors={sectors} />}
      {tab === 'instagram' && <SocialChannelManager kind="instagram" isAdmin={isAdmin} sectors={sectors} />}
      {tab === 'email' && <EmailChannelPanel isAdmin={isAdmin} />}
      {tab === 'llm' && <LlmWorkspaceChannelPanel isAdmin={isAdmin} />}
    </div>
  );
}
