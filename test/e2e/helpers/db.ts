import { Pool, type PoolClient, type QueryResultRow } from "pg";

let pool: Pool | null = null;

const getPool = (): Pool => {
  if (pool) return pool;
  const url = process.env.E2E_DATABASE_URL;
  if (!url) {
    throw new Error(
      "E2E_DATABASE_URL is not set — global-setup did not run, or env was lost between processes",
    );
  }
  pool = new Pool({ connectionString: url, max: 4 });
  return pool;
};

export const dbQuery = async <Row extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<Row[]> => {
  const result = await getPool().query<Row>(sql, params as never[]);
  return result.rows;
};

export const dbOne = async <Row extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<Row | null> => {
  const rows = await dbQuery<Row>(sql, params);
  return rows[0] ?? null;
};

export const withClient = async <T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
};
