// Temp: is the primary-calendar import running, and what's in the register?
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const keys = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'clerk-dev-keys.json'), 'utf8'));
const H = { Authorization: `Bearer ${keys.secret_key}`, 'Content-Type': 'application/json' };
const s = await fetch('https://api.clerk.com/v1/sessions', {
  method: 'POST', headers: H, body: JSON.stringify({ user_id: 'user_3LCBTsVo16q2e1Peqj1BfLYctmf' }),
}).then((r) => r.json());
const t = await fetch(`https://api.clerk.com/v1/sessions/${s.id}/tokens`, { method: 'POST', headers: H, body: '{}' }).then((r) => r.json());
const B = { Authorization: `Bearer ${t.jwt}`, 'Content-Type': 'application/json' };

const st = await fetch('http://localhost:9080/api/integrations/google', { headers: B }).then((r) => r.json());
console.log('STATUS:', JSON.stringify(st, null, 2));

const list = await fetch('http://localhost:9080/api/appointments?dateFrom=2026-10-01&dateTo=2026-12-31&limit=200', { headers: B }).then((r) => r.json());
const rows = list.data ?? [];
const ext = rows.filter((r) => r.externalSource);
console.log('\ntotal rows in window:', rows.length, '| imported from Google:', ext.length);
rows.slice(0, 12).forEach((a) => console.log(` • ${a.startAt} ${a.allDay ? '[all-day]' : ''} ${a.title} | ext=${a.externalSource ?? '-'}`));
