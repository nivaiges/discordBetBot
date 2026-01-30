import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Use a separate test database
const TEST_DB = path.join(__dirname, 'test_collect.db');

describe('Collect cooldown logic', () => {
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
    `);
  });

  after(async () => {
    db.close();
    const fs = await import('node:fs');
    for (const ext of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(TEST_DB + ext); } catch {}
    }
  });

  it('should allow first collect', () => {
    db.prepare('INSERT OR IGNORE INTO users (guild_id, discord_id) VALUES (?, ?)').run('g1', 'u1');
    const user = db.prepare('SELECT * FROM users WHERE guild_id = ? AND discord_id = ?').get('g1', 'u1');

    assert.equal(user.coins, 0);
    assert.equal(user.last_collect_at, null);

    // Simulate collect
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    db.prepare('UPDATE users SET coins = coins + 10000, last_collect_at = ? WHERE guild_id = ? AND discord_id = ?')
      .run(now, 'g1', 'u1');

    const updated = db.prepare('SELECT * FROM users WHERE guild_id = ? AND discord_id = ?').get('g1', 'u1');
    assert.equal(updated.coins, 10000);
    assert.ok(updated.last_collect_at);
  });

  it('should reject collect within 24 hours', () => {
    const user = db.prepare('SELECT * FROM users WHERE guild_id = ? AND discord_id = ?').get('g1', 'u1');
    const lastCollect = new Date(user.last_collect_at + 'Z');
    const now = new Date();
    const elapsed = now.getTime() - lastCollect.getTime();
    const cooldown = 24 * 60 * 60 * 1000;
    const remaining = cooldown - elapsed;

    // Since we just collected, remaining should be > 0
    assert.ok(remaining > 0, 'Should still be on cooldown');
  });

  it('should allow collect after cooldown expires', () => {
    // Set last_collect_at to 25 hours ago
    const pastDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const pastStr = pastDate.toISOString().replace('T', ' ').slice(0, 19);
    db.prepare('UPDATE users SET last_collect_at = ? WHERE guild_id = ? AND discord_id = ?')
      .run(pastStr, 'g1', 'u1');

    const user = db.prepare('SELECT * FROM users WHERE guild_id = ? AND discord_id = ?').get('g1', 'u1');
    const lastCollect = new Date(user.last_collect_at + 'Z');
    const now = new Date();
    const elapsed = now.getTime() - lastCollect.getTime();
    const cooldown = 24 * 60 * 60 * 1000;
    const remaining = cooldown - elapsed;

    assert.ok(remaining <= 0, 'Cooldown should have expired');
  });
});
