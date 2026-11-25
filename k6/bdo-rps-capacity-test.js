// Optional Lab 8 capacity probe: find how many requests/second the current
// local stack can sustain before p(95) crosses the 500 ms target.
// K6_BASE_URL=http://localhost:3001 k6 run k6/bdo-rps-capacity-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.K6_BASE_URL || 'http://localhost:3001';
const RPS = Number(__ENV.K6_RPS || 20);
const DURATION = __ENV.K6_DURATION || '20s';

export const options = {
  scenarios: {
    constant_request_rate: {
      executor: 'constant-arrival-rate',
      rate: RPS,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 10,
      maxVUs: 50
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<500']
  }
};

export default function () {
  const response = http.get(`${BASE}/api/drives`);
  check(response, { 'drive list is 200': (r) => r.status === 200 });
  sleep(0.1);
}
