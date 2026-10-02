'use client';



import Link from 'next/link';

import { MessageCircle } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

import type { OpsHubConversationRow } from '@/lib/ops/opsAnalyticsApi';

import { cn } from '@/lib/utils';



export function OperacaoAttendanceReviveCard({ conversation }: { conversation: OpsHubConversationRow }) {

  const updated = new Date(conversation.updated_at).toLocaleString('pt-BR', {

    day: '2-digit',

    month: 'short',

    hour: '2-digit',

    minute: '2-digit',

  });



  return (

    <Link href={`/inbox?conversation=${conversation.id}`} className="block">

      <Card className="border-border py-0 transition-colors hover:border-primary/40">

        <CardContent className="p-5">

          <div className="flex items-start gap-3">

            <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />

            <div className="min-w-0 flex-1">

              <p className="truncate text-sm font-semibold">{conversation.contact_name || 'Contato'}</p>

              <p className="truncate text-xs text-muted-foreground">{conversation.pharmacy_name || '—'}</p>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">

                <span

                  className={cn(

                    'rounded-md px-1.5 py-0.5 uppercase',

                    conversation.status === 'open' ? 'bg-primary/10 text-primary' : 'bg-muted'

                  )}

                >

                  {conversation.status}

                </span>

                {conversation.attendant_name ? <span>{conversation.attendant_name}</span> : null}

                <span className="font-mono">{updated}</span>

              </div>

            </div>

          </div>

        </CardContent>

      </Card>

    </Link>

  );

}

