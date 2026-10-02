/**
 * Verificacao pos-migration 019: pgvector habilitado, colunas ai_* presentes,
 * tabela ai_topics e indice HNSW criados.
 */
import pg from 'pg';
import { readDbUrl } from '../lib/readDbUrl.mjs';

const client = new pg.Client({ connectionString: readDbUrl(), ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const ext = await client.query(`SELECT extname FROM pg_extension WHERE extname='vector'`);
  console.log('extension vector:', ext.rowCount ? 'OK' : 'FAIL');

  const tableTopics = await client.query(`SELECT to_regclass('public.ai_topics') as r`);
  console.log('table ai_topics:', tableTopics.rows[0].r ? 'OK' : 'FAIL');

  const msgCols = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='messages'
      AND column_name IN ('ai_sentiment','ai_sentiment_score','ai_urgency','ai_urgency_score','ai_analyzed_at')
    ORDER BY column_name
  `);
  console.log('messages.ai_*:', msgCols.rows.map((r) => r.column_name).join(', ') || 'FAIL');

  const convCols = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='conversations'
      AND column_name IN ('ai_sentiment_last','ai_urgency_score','ai_topic_id','ai_topic_set_at','ai_topic_embedding','ai_nps_predicted','ai_nps_set_at')
    ORDER BY column_name
  `);
  console.log('conversations.ai_*:', convCols.rows.map((r) => r.column_name).join(', ') || 'FAIL');

  const idx = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname='public' AND tablename='ai_topics' AND indexname='idx_ai_topics_centroid_hnsw'
  `);
  console.log('index hnsw:', idx.rowCount ? 'OK' : 'FAIL');
} finally {
  await client.end();
}
