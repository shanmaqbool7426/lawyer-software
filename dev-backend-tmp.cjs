// Local dev backend launcher: MongoDB + built api-server on :9080.
// Clerk keys (accountless dev instance) activate real auth; no demo bypass.
// Extra secrets (Google OAuth, token keys) come from artifacts/api-server/.env,
// which is gitignored. The database lives on disk, so the Google connection and
// the case data survive a backend restart instead of asking for consent again.
const { MongoMemoryServer } = require('C:\\Users\\LAPTOP OUTLET\\AppData\\Local\\Temp\\mongo-smoke\\node_modules\\mongodb-memory-server');
const { spawn } = require('child_process');
const fs = require('fs');

const SERVER = 'C:\\projects\\lawyer-software\\artifacts\\api-server\\dist\\index.mjs';
const KEYS_FILE = 'C:\\Users\\LAPTOP OUTLET\\AppData\\Local\\Temp\\clerk-dev-keys.json';
const ENV_FILE = 'C:\\projects\\lawyer-software\\artifacts\\api-server\\.env';
const DB_DIR = 'C:\\Users\\LAPTOP OUTLET\\AppData\\Local\\Temp\\docketline-mongo';

/** Minimal .env reader: this launcher deliberately has no dotenv dependency. */
function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    out[trimmed.slice(0, eq).trim()] = value;
  }
  return out;
}

async function main() {
  fs.mkdirSync(DB_DIR, { recursive: true });
  // A fixed port (MONGO_PORT) keeps the on-disk database reachable by external
  // tools between restarts; without it the port is chosen at random.
  const port = Number(process.env.MONGO_PORT) || undefined;
  const mongod = await MongoMemoryServer.create({
    instance: { dbPath: DB_DIR, storageEngine: 'wiredTiger', ...(port ? { port } : {}) },
  });
  console.log('[mongo] on-disk MongoDB ready at', DB_DIR, mongod.getUri());
  const keys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...readEnvFile(ENV_FILE),
      ...process.env,
      DATABASE_URL: mongod.getUri(),
      PORT: '9080',
      NODE_ENV: 'development',
      CLERK_PUBLISHABLE_KEY: keys.publishable_key,
      CLERK_SECRET_KEY: keys.secret_key,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write('[api] ' + d));
  child.stderr.on('data', (d) => process.stdout.write('[api-err] ' + d));
  child.on('exit', (code) => {
    console.log('[api] exited with code', code);
    mongod.stop().catch(() => {});
    process.exit(code ?? 0);
  });
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
