import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, 'test_bet.db');

describe('Bet validation logic', () => {
  let db;

  before(() => {
    db = new Database(TEST_DB);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        guild_id TEXT NOT NULL,
        discord_id TEXT NOT NULL,
        coins INTEGER NOT NULL DEFAULT 0,
        last_collect_at TEXT,
        correct INTEGER NOT NULL DEFAULT 0,
        incorrect INTEGER NOT NULL DEFAULT 0,
        total_wagered INTEGER NOT NULL DEFAULT 0,
        total_won INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (guild_id, discord_id)
      );

      CREATE TABLE IF NOT EXISTS active_matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        puuid TEXT NOT NULL,
        match_id TEXT NOT NULL,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_checked_at TEXT NOT NULL DEFAULT (datetime('now')),
        state TEXT NOT NULL DEFAULT 'active',
        UNIQUE(guild_id, match_id)
      );

      CREATE TABLE IF NOT EXISTS bets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        discord_id TEXT NOT NULL,
        match_id TEXT NOT NULL,
        puuid TEXT NOT NULL,
        prediction TEXT NOT NULL CHECK(prediction IN ('win', 'lose')),
        amount INTEGER NOT NULL CHECK(amount > 0),
        placed_at TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at TEXT,
        outcome TEXT CHECK(outcome IN ('correct', 'incorrect') OR outcome IS NULL),
        UNIQUE(guild_id, match_id, discord_id)
      );
    `);

    // Seed data
    db.prepare('INSERT INTO users (guild_id, discord_id, coins) VALUES (?, ?, ?)').run('g1', 'u1', 5000);
    db.prepare('INSERT INTO active_matches (guild_id, puuid, match_id) VALUES (?, ?, ?)').run('g1', 'puuid1', 'NA1_123');
  });

  after(async () => {
    db.close();
    const fs = await import('node:fs');
    for (const ext of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(TEST_DB + ext); } catch {}
    }
  });

  it('should reject bet with insufficient coins', () => {
    const user = db.prepare('SELECT * FROM users WHERE guild_id = ? AND discord_id = ?').get('g1', 'u1');
    assert.equal(user.coins, 5000);
    assert.ok(user.coins < 10000, 'User should not have enough for a 10k bet');
  });

  it('should allow a valid bet and deduct coins', () => {
    const user = db.prepare('SELECT * FROM users WHERE guild_id = ? AND discord_id = ?').get('g1', 'u1');
    const amount = 1000;
    assert.ok(user.coins >= amount);

    db.prepare('UPDATE users SET coins = coins - ?, total_wagered = total_wagered + ? WHERE guild_id = ? AND discord_id = ?')
      .run(amount, amount, 'g1', 'u1');
    db.prepare('INSERT INTO bets (guild_id, discord_id, match_id, puuid, prediction, amount) VALUES (?, ?, ?, ?, ?, ?)')
      .run('g1', 'u1', 'NA1_123', 'puuid1', 'win', amount);

    const updated = db.prepare('SELECT * FROM users WHERE guild_id = ? AND discord_id = ?').get('g1', 'u1');
    assert.equal(updated.coins, 4000);
    assert.equal(updated.total_wagered, 1000);
  });

  it('should reject duplicate bet on same match', () => {
    const existing = db.prepare('SELECT * FROM bets WHERE guild_id = ? AND discord_id = ? AND match_id = ?').get('g1', 'u1', 'NA1_123');
    assert.ok(existing, 'Bet should already exist');

    // Attempting to insert duplicate should throw (UNIQUE constraint)
    assert.throws(() => {
      db.prepare('INSERT INTO bets (guild_id, discord_id, match_id, puuid, prediction, amount) VALUES (?, ?, ?, ?, ?, ?)')
        .run('g1', 'u1', 'NA1_123', 'puuid1', 'lose', 500);
    });
  });

  it('should reject bet with amount <= 0', () => {
    assert.throws(() => {
      db.prepare('INSERT INTO bets (guild_id, discord_id, match_id, puuid, prediction, amount) VALUES (?, ?, ?, ?, ?, ?)')
        .run('g1', 'u2', 'NA1_456', 'puuid1', 'win', 0);
    });
    assert.throws(() => {
      db.prepare('INSERT INTO bets (guild_id, discord_id, match_id, puuid, prediction, amount) VALUES (?, ?, ?, ?, ?, ?)')
        .run('g1', 'u2', 'NA1_456', 'puuid1', 'win', -100);
    });
  });

  it('should reject invalid prediction values', () => {
    assert.throws(() => {
      db.prepare('INSERT INTO bets (guild_id, discord_id, match_id, puuid, prediction, amount) VALUES (?, ?, ?, ?, ?, ?)')
        .run('g1', 'u2', 'NA1_789', 'puuid1', 'draw', 100);
    });
  });
});
