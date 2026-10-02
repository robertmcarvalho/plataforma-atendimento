import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { MessageCircle, Mail, Globe, Send } from 'lucide-react';

function InstagramIcon({ className, strokeWidth = 2.2 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

const channelConfig = {
  whatsapp: {
    icon: MessageCircle,
    color: 'text-channel-whatsapp',
    bg: 'bg-channel-whatsapp/10',
    label: 'WhatsApp',
  },
  instagram: {
    icon: InstagramIcon,
    color: 'text-channel-instagram',
    bg: 'bg-channel-instagram/10',
    label: 'Instagram',
  },
  email: {
    icon: Mail,
    color: 'text-channel-email',
    bg: 'bg-channel-email/10',
    label: 'E-mail',
  },
  webchat: {
    icon: Globe,
    color: 'text-channel-webchat',
    bg: 'bg-channel-webchat/10',
    label: 'Webchat',
  },
  telegram: {
    icon: Send,
    color: 'text-channel-telegram',
    bg: 'bg-channel-telegram/10',
    label: 'Telegram',
  },
} as const;

export type Channel = keyof typeof channelConfig;

interface ChannelBadgeProps {
  channel: Channel;
  size?: 'sm' | 'md';
  showLabel?: boolean;
  className?: string;
}

export function ChannelBadge({ channel, size = 'sm', showLabel = false, className }: ChannelBadgeProps) {
  const cfg = channelConfig[channel];
  const Icon = cfg.icon;
  const dim = size === 'sm' ? 'h-5 w-5' : 'h-7 w-7';
  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';

  return (
    <div className={cn('inline-flex items-center gap-1.5', className)}>
      <Badge
        variant="outline"
        className={cn('h-auto rounded-md border-transparent p-0', dim, cfg.bg)}
      >
        <Icon className={cn(iconSize, cfg.color)} strokeWidth={2.2} />
      </Badge>
      {showLabel ? <span className="text-xs font-medium text-muted-foreground">{cfg.label}</span> : null}
    </div>
  );
}
