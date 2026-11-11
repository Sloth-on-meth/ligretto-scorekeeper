import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { openDatabase } from './db.js';
import { createApp } from './app.js';
import { loadSettings } from './config.js';

const baseDir = path.dirname(fileURLToPath(import.meta.url));

// Local development: read ../.env if present. Variables already set in the environment
// (e.g. from Docker Compose) take precedence, because loadEnvFile never overwrites them.
const envFile = path.join(baseDir, '..', '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const loaded = loadSettings(process.env, baseDir);
if (!loaded.ok) {
  console.error('Configuration problems:');
  for (const error of loaded.errors) console.error(`  - ${error}`);
  console.error('Fix these in your .env file (see .env.example) and start again.');
  process.exit(1);
}
const settings = loaded.settings;
for (const warning of settings.warnings) console.warn(`[config] ${warning}`);

const db = openDatabase(settings.dbPath, settings.groupNames);
const app = createApp(db, { ...settings.app, distDir: settings.distDir });

const server = app.listen(settings.port);

server.once('listening', () => {
  console.log(`Server running on http://localhost:${settings.port}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${settings.port} is already in use. Stop the other process or set PORT in .env.`);
  } else {
    console.error('Server failed to start:', err);
  }
  process.exit(1);
});

// Stop accepting requests, let in-flight ones finish, then close the database cleanly
// (this flushes the SQLite WAL). Force-exit if something hangs.
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down…`);
  const force = setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
  force.unref();
  server.close(() => {
    try {
      db.close();
    } finally {
      process.exit(0);
    }
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
