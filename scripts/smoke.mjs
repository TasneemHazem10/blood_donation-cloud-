// Repeatable full-journey smoke test. Tracked in Git so a fresh clone can run it.
// Local development uses three ports; Floci exposes all services through one
// API Gateway URL. Cloudflare Workers can be supplied individually.
import fs from 'node:fs';
import path from 'node:path';

const gateway = process.env.BDO_API_URL;
const base = gateway
  ? { drive: gateway, donor: gateway, booking: gateway }
  : {
      drive: process.env.BDO_DRIVE_URL || 'http://localhost:3001',
      donor: process.env.BDO_DONOR_URL || 'http://localhost:3002',
      booking: process.env.BDO_BOOKING_URL || 'http://localhost:3003'
    };

// Floci generates a random invite in infra/secrets.env; do not require the
// caller to paste it (or print it) just to run the smoke test.
function inviteFromSecrets() {
  if (process.env.ORGANIZER_INVITE) return process.env.ORGANIZER_INVITE;
  try {
    const file = path.resolve('infra/secrets.env');
    const line = fs.readFileSync(file, 'utf8').split(/\r?\n/)
      .find((entry) => entry.startsWith('ORGANIZER_INVITE='));
    return line ? line.slice('ORGANIZER_INVITE='.length).trim().replace(/^["']|["']$/g, '') : 'blood2026';
  } catch {
    return 'blood2026';
  }
}
const inviteCode = inviteFromSecrets();

let pass = 0;
let fail = 0;

async function api(service, method, endpoint, body, token, expected) {
  let response;
  let data = null;
  try {
    response = await fetch(`${base[service]}${endpoint}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000)
    });
    const text = await response.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }
    }
  } catch (error) {
    console.log(`FAIL  ${service} ${method} ${endpoint} -> ${error.message}`);
    fail += 1;
    return { status: 0, data: null };
  }
  const ok = expected === undefined ? response.ok : response.status === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${service} ${method} ${endpoint} -> ${response.status}`);
  if (!ok) console.log('  ', JSON.stringify(data));
  if (ok) pass += 1;
  else fail += 1;
  return { status: response.status, data };
}

// Fresh accounts each run: a previous smoke run records a donation, and the
// 56-day eligibility rule correctly blocks that donor from booking again.
const suffix = Date.now().toString(36);
const orgEmail = `organizer-${suffix}@demo.org`;
const donorEmail = `donor-${suffix}@demo.org`;
const password = 'DemoPass123!';
await api('donor', 'POST', '/api/auth/register', {
  email: orgEmail, password, name: 'Smoke Organizer', role: 'organizer', inviteCode
}, null, 201);
await api('donor', 'POST', '/api/auth/register', {
  email: donorEmail, password, name: 'Smoke Donor', bloodType: 'O+', weightKg: 68, birthYear: 1998
}, null, 201);
const org = await api('donor', 'POST', '/api/auth/login', { email: orgEmail, password }, null, 200);
const don = await api('donor', 'POST', '/api/auth/login', { email: donorEmail, password }, null, 200);
const orgToken = org.data?.token;
const donToken = don.data?.token;
await api('donor', 'GET', '/api/auth/me', undefined, donToken, 200);

const date = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
const drive = await api('drive', 'POST', '/api/drives', {
  title: 'Node Smoke Drive', venue: 'City Health Centre', city: 'Kuwait City', date, description: 'Full flow'
}, orgToken, 201);
const driveId = drive.data?.id;
const slot = await api('drive', 'POST', `/api/drives/${driveId}/slots`, {
  startTime: '09:00', endTime: '11:00', capacity: 2
}, orgToken, 201);
const slotId = slot.data?.id;
const elig = await api('donor', 'GET', `/api/donors/me/eligibility?date=${date}`, undefined, donToken, 200);
console.log('  eligibility:', elig.data?.eligible, elig.data?.reason);

const booking = await api('booking', 'POST', '/api/bookings', { driveId, slotId }, donToken, 201);
const bookingId = encodeURIComponent(booking.data?.booking?.id || '');
console.log('  booking id:', booking.data?.booking?.id);
await api('booking', 'POST', '/api/bookings', { driveId, slotId }, donToken, 409);
await api('booking', 'GET', '/api/bookings/mine', undefined, donToken, 200);
await api('booking', 'GET', `/api/bookings?driveId=${driveId}`, undefined, orgToken, 200);
const reminder1 = await api('booking', 'POST', '/api/reminders/send', { date }, orgToken, 200);
const reminder2 = await api('booking', 'POST', '/api/reminders/send', { date }, orgToken, 200);
console.log('  reminders:', reminder1.data?.sent, 'sent,', reminder2.data?.skipped, 'skipped on repeat');
const checkin = await api('booking', 'PATCH', `/api/bookings/${bookingId}/check-in`, { outcome: 'attended' }, orgToken, 200);
console.log('  check-in:', checkin.data?.booking?.status, checkin.data?.message);
const donations = await api('donor', 'GET', '/api/donors/me/donations', undefined, donToken, 200);
console.log('  donations:', donations.data?.count);
const report = await api('drive', 'GET', `/api/drives/${driveId}/report`, undefined, orgToken, 200);
console.log('  report:', JSON.stringify({
  booked: report.data?.booked, attended: report.data?.attended,
  turnout: report.data?.turnoutRate, storage: report.data?.storage
}));

await api('booking', 'GET', '/api/bookings/mine', undefined, null, 401);
await api('booking', 'GET', `/api/bookings?driveId=${driveId}`, undefined, donToken, 403);
await api('drive', 'GET', '/api/drives/does_not_exist', undefined, null, 404);
await api('drive', 'POST', '/api/drives', { title: 'x' }, orgToken, 400);
await api('donor', 'POST', '/api/auth/register', {
  email: donorEmail, password, name: 'Dup', bloodType: 'O+', weightKg: 68, birthYear: 1998
}, null, 409);

console.log(`\nSMOKE: ${pass}/${pass + fail} PASS`);
if (fail > 0) process.exitCode = 1;
