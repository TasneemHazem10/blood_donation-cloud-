// Lab 8 scale test, adapted to the Blood Donation Drive Organizer.
// k6 run k6/bdo-load-test.js
// K6_BASE_URL=http://localhost:3001 k6 run k6/bdo-load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.K6_BASE_URL || 'http://localhost:3001';
const VUS = Number(__ENV.K6_VUS || 10);
const DURATION = __ENV.K6_DURATION || '30s';

export const options = {
  vus: VUS,
  duration: DURATION,
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<500']
  }
};

export default function () {
  const health = http.get(`${BASE}/api/health/drive`, { tags: { endpoint: 'health' } });
  check(health, {
    'drive health is 200': (r) => r.status === 200
  });

  const drives = http.get(`${BASE}/api/drives`, { tags: { endpoint: 'drives' } });
  check(drives, {
    'drive list is 200': (r) => r.status === 200,
    'drive list is JSON': (r) => r.headers['Content-Type']?.includes('application/json')
  });

  sleep(1);
}
