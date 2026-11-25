import { request } from '../api.js';
import { esc, formatDate, statusBadge, emptyState, isCurrent } from '../ui.js';

export async function renderHome(root, ctx) {
  root.innerHTML = `<section class="hero">
      <div>
        <span class="badge" style="background:rgba(255,255,255,.18);color:white">Community donation platform</span>
        <h1>Give blood, give someone tomorrow.</h1>
        <p>Find a donation drive near you, check whether today is a good day for you to donate, and reserve a seat in seconds. Organizers run the whole day from one dashboard.</p>
        <div class="hero-actions">
          <a class="btn btn-light" href="#/drives">Find a drive →</a>
          ${ctx.user ? '' : '<a class="btn btn-ghost" href="#/register">Register as a donor</a>'}
        </div>
        <div class="hero-stats">
          <div><strong id="statDrives">…</strong><span>drives published</span></div>
          <div><strong id="statSeats">…</strong><span>seats available</span></div>
          <div><strong>56</strong><span>days between donations</span></div>
        </div>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><div><h2>How it works</h2><p>Three connected services, one journey.</p></div></div>
      <div class="grid grid-3">
        <article class="card"><div class="feature-icon">1</div><h3>Check your eligibility</h3><p>Your profile and donation history decide when you can donate next. No guesswork.</p></article>
        <article class="card"><div class="feature-icon">2</div><h3>Book a time slot</h3><p>See live seat counts, reserve a seat and get a confirmation by email.</p></article>
        <article class="card"><div class="feature-icon">3</div><h3>Organize the day</h3><p>Manage slots, check in donors, send reminders and export a turnout report.</p></article>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><div><h2>Upcoming drives</h2><p>Live data from the Drive Management service.</p></div>
        <a class="btn btn-light btn-small" href="#/drives">See all drives</a></div>
      <div id="homeDrives" class="grid grid-3"><div class="loading-screen">Loading drives…</div></div>
    </section>`;

  try {
    const data = await request('drive', 'GET', '/api/drives', { auth: false });
    if (!isCurrent(ctx)) return;
    const drives = (data.drives || []).filter((drive) => drive.status === 'scheduled').slice(0, 3);
    root.querySelector('#statDrives').textContent = String(data.count || 0);
    root.querySelector('#statSeats').textContent = String(drives.reduce((sum, drive) =>
      sum + (drive.slots || []).reduce((total, slot) => total + (slot.available || 0), 0), 0));
    root.querySelector('#homeDrives').innerHTML = drives.length
      ? drives.map((drive) => `<article class="card">
          <div class="card-meta">${statusBadge(drive.status)}<span>${esc(drive.city)}</span></div>
          <h3>${esc(drive.title)}</h3>
          <p>${esc(drive.description || 'Join us for this donation drive.')}</p>
          <div class="card-meta"><span>📅 ${formatDate(drive.date)}</span><span>📍 ${esc(drive.venue)}</span></div>
          <a class="btn btn-primary btn-small" href="#/drives/${encodeURIComponent(drive.id)}">View slots</a>
        </article>`).join('')
      : emptyState('No upcoming drives yet', 'An organizer can create the first drive from the Organizer page.');
  } catch (error) {
    if (!isCurrent(ctx)) return;
    root.querySelector('#homeDrives').innerHTML = `<div class="alert alert-error">${esc(error.message)}</div>`;
    root.querySelector('#statDrives').textContent = '—';
    root.querySelector('#statSeats').textContent = '—';
  }
}
