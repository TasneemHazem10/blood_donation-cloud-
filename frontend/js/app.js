import { request, getToken, getStoredUser, setSession, clearSession } from './api.js';
import { renderNav, markNav, toast, esc, isCurrent } from './ui.js';
import { renderHome } from './views/home.js';
import { renderLogin, renderRegister } from './views/auth.js';
import { renderDrives, renderDriveDetail } from './views/drives.js';
import { renderProfile, renderBookings } from './views/donor.js';
import { renderOrganizer } from './views/organizer.js';

const app = document.getElementById('app');
let user = getStoredUser();
let renderSequence = 0;
let restoringSession = true;

const routes = [
  { re: /^\/$/, view: renderHome, nav: 'home' },
  { re: /^\/drives$/, view: renderDrives, nav: 'drives' },
  { re: /^\/drives\/([^/]+)$/, view: renderDriveDetail, nav: 'drives', param: 'id' },
  { re: /^\/login$/, view: renderLogin, nav: 'login', guestOnly: true },
  { re: /^\/register$/, view: renderRegister, nav: 'register', guestOnly: true },
  { re: /^\/profile$/, view: renderProfile, nav: 'profile', protected: true },
  { re: /^\/bookings$/, view: renderBookings, nav: 'bookings', protected: true },
  { re: /^\/organizer$/, view: renderOrganizer, nav: 'organizer', protected: true, role: 'organizer' }
];

function parseHash() {
  const raw = location.hash.slice(1) || '/';
  const [pathname, queryString] = raw.split('?');
  return { pathname, query: Object.fromEntries(new URLSearchParams(queryString || '')) };
}

function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function render() {
  if (!app) return;
  const sequence = ++renderSequence;
  const ctx = { user, isCurrent: () => sequence === renderSequence };
  const { pathname, query } = parseHash();
  const definition = routes.find((route) => route.re.test(pathname));
  if (!definition) {
    if (isCurrent(ctx)) {
      app.innerHTML = '<div class="empty"><strong>Page not found</strong><a class="btn btn-primary mt" href="#/">Back home</a></div>';
    }
    return;
  }
  if (definition.protected && !user) {
    toast('Please log in to view that page.', 'error');
    location.hash = '#/login';
    return;
  }
  if (definition.role && user && user.role !== definition.role) {
    if (isCurrent(ctx)) {
      app.innerHTML = '<div class="alert alert-error">This page is only available to organizers.</div>';
    }
    return;
  }
  if (definition.guestOnly && user) {
    location.hash = '#/';
    return;
  }

  const match = definition.re.exec(pathname);
  const params = definition.param && match ? { [definition.param]: decodeURIComponent(match[1]) } : {};
  if (!isCurrent(ctx)) return;
  renderNav(user);
  markNav(definition.nav);
  app.innerHTML = '<div class="loading-screen"><span class="spinner"></span><p>Loading the latest data…</p></div>';
  try {
    await definition.view(app, { ...ctx, params, query, navigate });
  } catch (error) {
    if (isCurrent(ctx)) {
      app.innerHTML = `<div class="alert alert-error">${esc(error && error.message ? error.message : error)}</div>`;
    }
  }
}

async function restoreSession() {
  if (!getToken()) {
    restoringSession = false;
    render();
    return;
  }
  try {
    const data = await request('donor', 'GET', '/api/auth/me');
    user = data.user;
    setSession(getToken(), user);
  } catch {
    clearSession();
    user = null;
  }
  restoringSession = false;
  render();
}

async function checkServices() {
  const status = document.getElementById('systemStatus');
  if (!status) return;
  const names = ['drive', 'donor', 'booking'];
  const results = await Promise.all(names.map((name) =>
    request(name, 'GET', `/api/health/${name}`, { auth: false }).then(() => true).catch(() => false)));
  const online = results.filter(Boolean).length;
  if (!status.isConnected) return;
  status.textContent = `${online}/3 services online`;
  status.style.color = online === 3 ? 'var(--green)' : 'var(--red)';
}

const navToggle = document.getElementById('navToggle');
if (navToggle) navToggle.onclick = (event) => {
  const nav = document.getElementById('siteNav');
  if (!nav) return;
  nav.classList.toggle('open');
  event.currentTarget.setAttribute('aria-expanded', nav.classList.contains('open') ? 'true' : 'false');
};

window.addEventListener('hashchange', () => { if (!restoringSession) render(); });
window.addEventListener('bdo:session', () => { user = getStoredUser(); render(); });
restoreSession();
checkServices();
