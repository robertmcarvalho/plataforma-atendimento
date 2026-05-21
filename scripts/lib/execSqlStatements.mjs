/**
 * Executa um ficheiro .sql com vários statements (linha a linha até `;` no fim da linha).
 * Ignora linhas vazias e comentários `--` no início de bloco.
 * Dentro de blocos `$$ ... $$` (PL/pgSQL / dollar quotes), `;` no fim de linha não encerra o statement.
 * @param {import("pg").Client} client
 * @param {string} sql
 */
export async function execSqlStatements(client, sql) {
  const statements = [];
  let buf = '';
  let inDollarQuote = false;

  for (const line of sql.split(/\r?\n/)) {
    const t = line.trim();
    if (!buf && !inDollarQuote && (!t || t.startsWith('--'))) continue;

    const dollarPairs = line.match(/\$\$/g);
    if (dollarPairs) {
      for (let i = 0; i < dollarPairs.length; i += 1) {
        inDollarQuote = !inDollarQuote;
      }
    }

    buf += `${line}\n`;

    if (!inDollarQuote && t.endsWith(';')) {
      statements.push(buf.trim());
      buf = '';
    }
  }
  if (buf.trim()) statements.push(buf.trim());
  for (const st of statements) {
    if (st) await client.query(st);
  }
}
