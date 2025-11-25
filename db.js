import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL, // e.g., postgres://user:pass@host:5432/db
  ssl: { rejectUnauthorized: false }             // Supabase requires SSL
});

export const q = async (text, params) => {
  const res = await pool.query(text, params);
  return res;
};
