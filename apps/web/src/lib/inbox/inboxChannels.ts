import type { Channel } from '@/components/ui/ChannelBadge';
import { features } from '@/lib/features';

export const inboxChannels: Channel[] = [
  'whatsapp',
  ...(features.channels.instagram ? (['instagram'] as Channel[]) : []),
  ...(features.channels.email ? (['email'] as Channel[]) : []),
];
