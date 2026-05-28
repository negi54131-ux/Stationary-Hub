const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const isPostgres = !!process.env.DATABASE_URL;

if (isPostgres) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  async function ensureSchema() {
    const sql = fs.readFileSync(path.join(__dirname, 'initial_postgres.sql'), 'utf8');
    try {
      await pool.query(sql);
    } catch (e) {
      console.error('Error ensuring Postgres schema:', e);
    }
  }

  ensureSchema();

  module.exports = {
    query: (text, params) => pool.query(text, params),
    pool
  };
} else {
  // Fallback to existing SQLite in-memory for local dev if better-sqlite3 not available
  const Database = require('better-sqlite3');
  const DB_PATH = path.join(__dirname, 'stationery.db');
  const db = new Database(DB_PATH);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schemaSql = fs.readFileSync(path.join(__dirname, 'initial_sqlite.sql'), 'utf8');
  try {
    db.exec(schemaSql);
  } catch (e) {
    console.error('Error ensuring SQLite schema:', e);
  }

  module.exports = db;
}
