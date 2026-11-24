// Small presentation helpers shared by every screen.
export function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function toast(message, type = 'info') {
  const host = document.getElementById('toastHost');
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  host.appendChild(node);
  setTimeout(() => node.remove(), 4800);
}

export function errorBox(error) {
  return `<div class="alert alert-error"><strong>Request failed.</strong> ${esc(error && error.message ? error.message : error)}</div>`;
}

export function infoBox(message) {
  return `<div class="alert alert-info">${esc(message)}</div>`;
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString(undefined, { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
}

export function statusBadge(status) {
  const map = {
    scheduled: ['info', 'Scheduled'], cancelled: ['bad', 'Cancelled'], completed: ['ok', 'Completed'],
    confirmed: ['ok', 'Confirmed'], attended: ['ok', 'Attended'], no_show: ['warn', 'No-show'],
    sent: ['ok', 'Sent'], 'dev-log': ['info', 'Logged (dev)'], failed: ['bad', 'Failed'], pending: ['warn', 'Pending']
  };
  const [tone, label] = map[status] || ['', status || 'Unknown'];
  return `<span class="badge ${tone}"><span class="dot"></span>${esc(label)}</span>`;
}

export function emptyState(title, text, action = '') {
  return `<div class="empty"><strong>${esc(title)}</strong><span>${esc(text)}</span>${action ? `<div class="mt">${action}</div>` : ''}</div>`;
}

export function formValue(form, name) {
  const field = form.elements[name];
  return field ? field.value.trim() : '';
}

export function confirmDialog(title, message, confirmLabel = 'Confirm') {
  return new Promise((resolve) => {
    const host = document.getElementById('modalHost');
    host.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">
      <h2>${esc(title)}</h2><p class="muted">${esc(message)}</p>
      <div class="form-actions"><button class="btn btn-danger" data-yes>${esc(confirmLabel)}</button>
      <button class="btn btn-light" data-no>Cancel</button></div></div></div>`;
    const close = (answer) => { host.innerHTML = ''; resolve(answer); };
    host.querySelector('[data-yes]').onclick = () => close(true);
    host.querySelector('[data-no]').onclick = () => close(false);
    host.querySelector('.modal-backdrop').onclick = (event) => {
      if (event.target === event.currentTarget) close(false);
    };
  });
}

export function renderNav(user) {
  const nav = document.getElementById('siteNav');
  const links = [
    ['#/', 'Home', 'home'],
    ['#/drives', 'Find a drive', 'drives'],
    ['#/bookings', 'My bookings', 'bookings'],
    user && user.role === 'organizer' ? ['#/organizer', 'Organizer', 'organizer'] : null,
    ['#/profile', 'Profile', 'profile']
  ].filter(Boolean);

  nav.innerHTML = links.map(([href, label, key]) =>
    `<a href="${href}" data-nav="${key}">${esc(label)}</a>`).join('')
    + (user
      ? `<span class="role-pill">${esc(user.role === 'organizer' ? 'Organizer' : 'Donor')}</span>
         <button type="button" data-logout>Log out</button>`
      : `<a href="#/login" data-nav="login">Log in</a>
         <a class="btn btn-primary btn-small" href="#/register" data-nav="register">Join a drive</a>`);

  nav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      nav.classList.remove('open');
      document.getElementById('navToggle').setAttribute('aria-expanded', 'false');
    });
  });
  const logout = nav.querySelector('[data-logout]');
  if (logout) logout.onclick = async () => {
    const { clearSession } = await import('./api.js');
    clearSession();
    window.dispatchEvent(new Event('bdo:session'));
    location.hash = '#/';
  };
}

export function markNav(key) {
  document.querySelectorAll('[data-nav]').forEach((link) => {
    link.classList.toggle('active', link.dataset.nav === key);
  });
}
