import { supabase } from '../lib/supabase';

export async function sendCycleReminders() {
  const now = new Date();
  const day = now.getDay(); // 0-6 (Sun-Sat)
  const hour = now.getHours();

  // Lembrete de Faltas: Segunda (1) às 8h e 10h
  if (day === 1 && (hour === 8 || hour === 10)) {
    await broadcastToLeaders('🚨 Lembrete: Prazo para lançamento de Faltas encerra hoje às 11h!');
  }

  // Lembrete de Diárias: Terça (2) e Quinta (4) às 8h e 10h
  if ((day === 2 || day === 4) && (hour === 8 || hour === 10)) {
    await broadcastToLeaders(`💰 Lembrete: Apuração de Diárias encerra hoje às 11h. Não esqueça de lançar!`);
  }
}

async function broadcastToLeaders(message: string) {
  // Busca todos os líderes ativos que tenham contato vinculado
  const { data: leaders } = await supabase
    .from('leaders')
    .select('id, name, phone, contacts(id)')
    .eq('status', 'active');

  if (!leaders) return;

  for (const leader of leaders) {
    const contactId = (leader as any).contacts?.[0]?.id;
    if (!contactId) continue;

    // Cria a conversa se não existir e envia mensagem
    const { data: conv } = await supabase
      .from('conversations')
      .select('id')
      .eq('contact_id', contactId)
      .neq('status', 'closed')
      .limit(1)
      .single();

    let convId = conv?.id;

    if (!convId) {
      const { data: newConv } = await supabase
        .from('conversations')
        .insert({
          contact_id: contactId,
          status: 'open',
          priority: 'high'
        })
        .select().single();
      convId = newConv?.id;
    }

    if (convId) {
      await supabase.from('messages').insert({
        conversation_id: convId,
        direction: 'outbound',
        type: 'text',
        content: message,
        sender_id: 'b041c743-fb15-40e9-a905-6dc1899e701a' // Admin / Sistema
      });
    }
  }
}
