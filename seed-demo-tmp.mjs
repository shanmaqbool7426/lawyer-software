// Temp: rebuild the demo matter after a backend restart (memory Mongo is wiped).
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
const post = async (p, body) => {
  const r = await fetch(`http://localhost:9080/api${p}`, { method: 'POST', headers: B, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${p} -> ${r.status} ${JSON.stringify(j)}`);
  return j;
};

const client = await post('/clients', { fullName: 'Ayesha Khan', phone: '416-555-0142', leadSourceChannel: 'google' });
const matter = await post('/cases', {
  clientId: client.id,
  intakeDate: '2026-10-20T00:00:00.000Z',
  offenceDate: '2026-09-14T00:00:00.000Z',
  status: 'Awaiting Trial',
  totalFee: 2500,
  ticketNumber: 'AX4471902',
  offenceDescription: 'Speeding 15 over',
  courtLocation: 'Toronto — Old City Hall',
});
await post(`/cases/${matter.id}/court-dates`, { date: '2026-11-18T00:00:00.000Z', notes: 'First appearance' });
await post('/appointments', {
  clientId: client.id, caseId: matter.id, title: 'Consultation — Ayesha Khan', type: 'Consultation',
  startAt: '2026-11-04T15:00:00.000Z', endAt: '2026-11-04T16:00:00.000Z', status: 'scheduled',
});
await post('/appointments', {
  clientId: client.id, caseId: matter.id, title: 'Trial prep — Ayesha Khan', type: 'Other',
  startAt: '2026-11-16T08:00:00.000Z', endAt: '2026-11-17T08:00:00.000Z', status: 'confirmed', allDay: true,
});
console.log('seeded client', client.id, '| case', matter.id);
