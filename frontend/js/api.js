// Presentation -> application layer. Every screen reads through this module.
const config = () => window.BDO || { services: {} };
const TOKEN_KEY = 'bdo.token';
const USER_KEY = 'bdo.user';

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function setSession(token, user) {
  if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY);
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user)); else localStorage.removeItem(USER_KEY);
}
export function getStoredUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
}
export function clearSession() { setSession(null, null); }

export async function request(service, method, path, options = {}) {
  const base = (config().services || {})[service];
  if (!base) throw { status: 0, message: `No API address configured for ${service}` };
  const headers = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.auth !== false && getToken()) headers.Authorization = `Bearer ${getToken()}`;

  let response;
  try {
    response = await fetch(`${base.replace(/\/$/, '')}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
  } catch (error) {
    throw { status: 0, message: `Cannot reach the ${service} service. Check your connection or deployment.` };
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { error: { message: text } }; }
  }
  if (!response.ok) {
    throw {
      status: response.status,
      code: data && data.error && data.error.code,
      message: data && data.error && data.error.message ? data.error.message : `Request failed (${response.status})`
    };
  }
  return data;
}

export function isLoggedIn() { return Boolean(getToken() && getStoredUser()); }
