'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useRef } from 'react';
import { MessageCircle, Send, User, ChevronRight } from 'lucide-react';
import api from '@/lib/api';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';

export default function LeaderSupportReal() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [showSectorModal, setShowSectorModal] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: sectors = [] } = useQuery<any[]>({
    queryKey: ['sectors-for-leader'],
    queryFn: () => api.get('/api/sectors').then(r => r.data),
  });

  const { data: conversations = [], isLoading } = useQuery<any[]>({
    queryKey: ['leader-support-conversations'],
    queryFn: () => api.get('/api/conversations').then(r => r.data.data),
    refetchInterval: 10000,
  });

  const { data: activeConv, isLoading: loadingConv } = useQuery<any>({
    queryKey: ['conversation', selectedId],
    queryFn: () => selectedId ? api.get(`/api/conversations/${selectedId}`).then(r => r.data) : null,
    enabled: !!selectedId,
    refetchInterval: 5000,
  });

  const sendMutation = useMutation({
    mutationFn: (text: string) => api.post('/api/messages/send', {
      conversation_id: selectedId,
      type: 'text',
      content: text
    }),
    onSuccess: () => {
      setMessage('');
      queryClient.invalidateQueries({ queryKey: ['conversation', selectedId] });
    }
  });

  const createConvMutation = useMutation({
    mutationFn: (sector_id: string) => api.post('/api/conversations/start', {
      sector_id,
      topic: 'Suporte Líder',
      source: 'web_portal'
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['leader-support-conversations'] });
      setSelectedId(res.data.id);
      setShowSectorModal(false);
    }
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeConv?.messages]);

  return (
    <div className="flex h-full bg-background overflow-hidden">
      {/* Sidebar de Conversas */}
      <div className="w-80 border-r border-border flex flex-col bg-surface/30">
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-bold mb-4">Suporte Operacional</h2>
          <button 
            onClick={() => setShowSectorModal(true)}
            className="w-full button-primary flex items-center justify-center gap-2 text-sm"
          >
            <MessageCircle size={16} />
            Nova Conversa
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-center text-muted-foreground text-sm">Carregando...</div>
          ) : conversations.length === 0 ? (
            <div className="p-8 text-center">
              <MessageCircle size={40} className="mx-auto mb-2 opacity-20" />
              <p className="text-xs text-muted-foreground">Nenhum histórico encontrado.</p>
            </div>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={cn(
                  "w-full p-4 text-left border-b border-border/50 hover:bg-surface-hover transition-colors",
                  selectedId === c.id && "bg-accent-soft border-l-4 border-l-accent"
                )}
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="text-xs font-bold text-accent uppercase tracking-wider">#{c.id.slice(0, 8)}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {c.last_message_at ? formatDistanceToNow(new Date(c.last_message_at), { addSuffix: true, locale: ptBR }) : ''}
                  </span>
                </div>
                <p className="text-sm font-medium truncate">
                  {c.sectors?.name ? `Suporte: ${c.sectors.name}` : 'Chat com Atendimento'}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <span className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                    c.status === 'open' ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
                  )}>
                    {c.status === 'open' ? 'Ativo' : 'Encerrado'}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Janela de Chat */}
      <div className="flex-1 flex flex-col relative">
        {selectedId ? (
          <>
            {/* Chat Header */}
            <div className="h-16 border-b border-border flex items-center justify-between px-6 bg-surface/50 backdrop-blur-sm sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-accent/10 flex items-center justify-center text-accent">
                  <User size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-bold">
                    {activeConv?.sectors?.name ? `Setor: ${activeConv.sectors.name}` : 'Time de Atendimento'}
                  </h3>
                  <div className="flex items-center gap-1.5">
                    <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
                    <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">Online</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4 bg-background/50">
              {loadingConv ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">Carregando conversa...</div>
              ) : (
                activeConv?.messages?.map((msg: any) => (
                  <div 
                    key={msg.id} 
                    className={cn(
                      "flex flex-col max-w-[80%]",
                      msg.direction === 'outbound' ? "ml-auto items-end" : "items-start"
                    )}
                  >
                    <div className={cn(
                      "p-3 rounded-2xl text-sm shadow-sm",
                      msg.direction === 'outbound' 
                        ? "bg-accent text-white rounded-tr-none" 
                        : "bg-surface border border-border rounded-tl-none"
                    )}>
                      {msg.content}
                    </div>
                    <span className="text-[10px] text-muted-foreground mt-1 px-1">
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Composer */}
            <div className="p-4 border-t border-border bg-surface/80 backdrop-blur-md">
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  if (message.trim()) sendMutation.mutate(message);
                }}
                className="flex gap-2"
              >
                <input 
                  type="text"
                  placeholder="Digite sua mensagem..."
                  className="flex-1 bg-background border border-border rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={sendMutation.isPending}
                />
                <button 
                  type="submit"
                  disabled={!message.trim() || sendMutation.isPending}
                  className="h-10 w-10 rounded-full bg-accent text-white flex items-center justify-center hover:bg-accent-hover transition-colors disabled:opacity-50"
                >
                  <Send size={18} />
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="h-20 w-20 rounded-3xl bg-surface-2 flex items-center justify-center text-muted-foreground mb-4">
              <MessageCircle size={40} className="opacity-20" />
            </div>
            <h3 className="text-lg font-bold mb-2">Suporte Direto</h3>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              Selecione uma conversa ao lado ou inicie um novo chamado para falar com nossa equipe operacional.
            </p>
          </div>
        )}
      </div>

      {/* Modal de Seleção de Setor */}
      {showSectorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface w-full max-w-md rounded-2xl shadow-2xl border border-border overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-border">
              <h3 className="text-xl font-bold">Iniciar Atendimento</h3>
              <p className="text-sm text-muted-foreground mt-1">Com qual setor você deseja falar?</p>
            </div>
            <div className="p-4 grid gap-2">
              {sectors.filter(s => s.is_active !== false).map(s => (
                <button
                  key={s.id}
                  onClick={() => createConvMutation.mutate(s.id)}
                  disabled={createConvMutation.isPending}
                  className="flex items-center justify-between p-4 rounded-xl border border-border bg-surface-2 hover:bg-accent/5 hover:border-accent group transition-all text-left"
                >
                  <span className="font-semibold group-hover:text-accent transition-colors">{s.name}</span>
                  <ChevronRight size={16} className="text-muted-foreground group-hover:text-accent group-hover:translate-x-1 transition-all" />
                </button>
              ))}
            </div>
            <div className="p-4 bg-surface-2 border-t border-border">
              <button 
                onClick={() => setShowSectorModal(false)}
                className="w-full button-secondary"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
