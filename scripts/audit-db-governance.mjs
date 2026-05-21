#!/usr/bin/env node
import { Client } from 'pg';
import { readDbUrl } from './lib/readDbUrl.mjs';

const connectionString = readDbUrl();
const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });

async function listRows(sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows;
}

async function main() {
  await client.connect();
  try {
    const tables = await listRows(`
      select
        c.table_schema,
        c.table_name,
        bool_or(c.column_name = 'workspace_id') as has_workspace_id,
        coalesce(pc.relrowsecurity, false) as rls_enabled
      from information_schema.columns c
      join pg_class pc on pc.relname = c.table_name
      join pg_namespace pn on pn.oid = pc.relnamespace and pn.nspname = c.table_schema
      where c.table_schema = 'public'
        and pc.relkind = 'r'
      group by c.table_schema, c.table_name, pc.relrowsecurity
      order by c.table_name
    `);

    const indexes = await listRows(`
      select
        schemaname,
        tablename,
        indexname,
        indexdef
      from pg_indexes
      where schemaname = 'public'
      order by tablename, indexname
    `);

    const vectorColumns = await listRows(`
      select table_schema, table_name, column_name, udt_name
      from information_schema.columns
      where table_schema = 'public'
        and (udt_name = 'vector' or column_name ilike '%embedding%')
      order by table_name, column_name
    `);

    const workspaceTablesWithoutIndex = tables
      .filter((table) => table.has_workspace_id)
      .filter((table) => {
        const tableIndexes = indexes.filter((idx) => idx.tablename === table.table_name);
        return !tableIndexes.some((idx) => /\(workspace_id\)|workspace_id,/.test(idx.indexdef));
      })
      .map((table) => table.table_name);

    const globalTables = tables.filter((table) => !table.has_workspace_id).map((table) => table.table_name);
    const rlsDisabled = tables.filter((table) => !table.rls_enabled).map((table) => table.table_name);

    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: 'read-only',
          summary: {
            public_tables: tables.length,
            tables_with_workspace_id: tables.filter((table) => table.has_workspace_id).length,
            global_tables: globalTables.length,
            rls_disabled_tables: rlsDisabled.length,
            vector_or_embedding_columns: vectorColumns.length,
            workspace_tables_without_workspace_index: workspaceTablesWithoutIndex.length,
          },
          global_tables: globalTables,
          rls_disabled_tables: rlsDisabled,
          workspace_tables_without_workspace_index: workspaceTablesWithoutIndex,
          vector_or_embedding_columns: vectorColumns,
        },
        null,
        2
      )
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
