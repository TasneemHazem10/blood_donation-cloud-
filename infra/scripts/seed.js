'use strict';

// Optional demo seed. It creates records by calling the real APIs (no front-end data).
const BASES = {
  drive: 'http://localhost:3001',
  donor: 'http://localhost:3002',
  booking: 'http://localhost:3003'
};
const INVITE = process.env.ORGANIZER_INVITE || 'blood2026';

async function call(service, method, pathname, body, token) {
  const response = await fetch(`${BASES[service]}${pathname}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${service} ${method} ${pathname}: ${response.status} ${text}`);
  return data;
}

async function registerOrLogin(email, password, extra = {}) {
  try {
    return await call('donor', 'POST', '/api/auth/register', { email, password, name: extra.name || 'Demo User', ...extra });
  } catch {
    return call('donor', 'POST', '/api/auth/login', { email, password });
  }
}

(async () => {
  const stamp = Date.now().toString().slice(-6);
  const organizerEmail = `organizer${stamp}@demo.org`;
  const donorEmail = `donor${stamp}@demo.org`;
  const password = 'DemoPass123!';

  const organizer = await registerOrLogin(organizerEmail, password, { role: 'organizer', inviteCode: INVITE, name: 'Demo Organizer' });
  const donor = await registerOrLogin(donorEmail, password, {
    role: 'donor', name: 'Demo Donor', bloodType: 'O+', weightKg: 68, birthYear: 1998
  });

  const future = new Date();
  future.setUTCDate(future.getUTCDate() + 3);
  const drive = await call('drive', 'POST', '/api/drives', {
    title: 'Community Blood Drive', venue: 'City Health Centre', city: 'Kuwait City',
    date: future.toISOString().slice(0, 10), description: 'Demo drive created through the API.'
  }, organizer.token);

  await call('drive', 'POST', `/api/drives/${drive.id}/slots`, { startTime: '09:00', endTime: '11:00', capacity: 10 }, organizer.token);
  await call('drive', 'POST', `/api/drives/${drive.id}/slots`, { startTime: '11:30', endTime: '13:30', capacity: 10 }, organizer.token);

  console.log('\nDemo data created through the APIs:');
  console.log(`Organizer: ${organizerEmail} / ${password}`);
  console.log(`Donor:     ${donorEmail} / ${password}`);
  console.log(`Drive ID:  ${drive.id}`);
  console.log('Open http://localhost:8090 and log in with either account.\n');
})().catch((error) => { console.error(error.message); process.exit(1); });
