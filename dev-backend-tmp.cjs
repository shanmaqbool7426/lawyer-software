// Local dev backend launcher: in-memory MongoDB + built api-server on :9080.
// Clerk keys (accountless dev instance) activate real auth; no demo bypass.
// Data is fresh/ephemeral (lost on restart).
const { MongoMemoryServer } = require('C:\\Users\\LAPTOP OUTLET\\AppData\\Local\\Temp\\mongo-smoke\\node_modules\\mongodb-memory-server');
const { spawn } = require('child_process');
const fs = require('fs');

const SERVER = 'C:\\projects\\lawyer-software\\artifacts\\api-server\\dist\\index.mjs';
const KEYS_FILE = 'C:\\Users\\LAPTOP OUTLET\\AppData\\Local\\Temp\\clerk-dev-keys.json';

async function main() {
  const mongod = await MongoMemoryServer.create();
  console.log('[mongo] in-memory MongoDB ready');
  const keys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
  const child = spawn(process.execPath, [SERVER], {
    env: {
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
