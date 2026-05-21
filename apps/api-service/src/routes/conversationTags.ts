import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase';
import { authenticate } from '../middleware/authenticate';

export async function conversationTagRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const { data, error } = await supabase
      .from('conversation_tag_catalog')
      .select('slug, label_pt, sort_order, tone, is_system, is_user_editable')
      .order('sort_order', { ascending: true });
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data || []);
  });
}
