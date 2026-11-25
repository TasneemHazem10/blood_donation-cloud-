import { request } from '../api.js';
import { esc, formatDate, statusBadge, emptyState, toast, confirmDialog, isCurrent } from '../ui.js';

function driveCard(drive) {
  const seats = (drive.slots || []).reduce((total, slot) => total + Math.max(0, slot.capacity - slot.booked), 0);
  return `<article class="card">
    <div class="card-meta">${statusBadge(drive.status)}<span>${esc(drive.city)}</span>
      ${drive.distanceKm !== undefined ? `<span>📏 ${esc(drive.distanceKm)} km away</span>` : ''}</div>
    <h3>${esc(drive.title)}</h3>
    <p>${esc(drive.description || 'Donation drive open for bookings.')}</p>
    <div class="card-meta"><span>📅 ${formatDate(drive.date)}</span><span>📍 ${esc(drive.venue)}</span><span>🪑 ${seats} seats</span></div>
    <a class="btn btn-primary btn-small" href="#/drives/${encodeURIComponent(drive.id)}">View time slots</a>
  </article>`;
}

export async function renderDrives(root, ctx) {
  const q = ctx.query;
  root.innerHTML = `<section class="section" style="margin-top:8px">
    <div class="section-head"><div><h2>Find a donation drive</h2><p>Search live drives by city, date or distance from a place.</p></div></div>
    <form id="searchForm" class="panel">
      <div class="filters">
        <div class="field"><label for="city">City</label><input id="city" name="city" placeholder="e.g. Kuwait City" value="${esc(q.city || '')}" /></div>
        <div class="field"><label for="dateFrom">From</label><input id="dateFrom" name="dateFrom" type="date" value="${esc(q.dateFrom || '')}" /></div>
        <div class="field"><label for="dateTo">To</label><input id="dateTo" name="dateTo" type="date" value="${esc(q.dateTo || '')}" /></div>
        <div class="field"><label for="near">Near a place</label><input id="near" name="near" placeholder="e.g. Salmiya" value="${esc(q.near || '')}" /></div>
        <div class="field"><label for="radius">Radius (km)</label><input id="radius" name="radius" type="number" min="1" max="500" value="${esc(q.radius || '25')}" /></div>
      </div>
      <div class="form-actions"><button class="btn btn-primary" type="submit">Search drives</button>
        <a class="btn btn-light" href="#/drives">Clear filters</a></div>
    </form>
  </section>
  <section class="section"><div id="driveResults" class="grid grid-3"><div class="loading-screen">Loading drives…</div></div></section>`;

  root.querySelector('#searchForm').onsubmit = (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const params = new URLSearchParams();
    ['city', 'dateFrom', 'dateTo', 'near', 'radius'].forEach((key) => {
      if (form.elements[key].value) params.set(key, form.elements[key].value);
    });
    ctx.navigate(`#/drives${params.toString() ? `?${params}` : ''}`);
  };

  try {
    const query = new URLSearchParams();
    ['city', 'dateFrom', 'dateTo', 'near', 'radius'].forEach((key) => { if (q[key]) query.set(key, q[key]); });
    const data = await request('drive', 'GET', `/api/drives${query.size ? `?${query}` : ''}`, { auth: false });
    if (!isCurrent(ctx)) return;
    root.querySelector('#driveResults').innerHTML = data.drives && data.drives.length
      ? data.drives.map(driveCard).join('')
      : emptyState('No drives found', 'Try different filters, or ask an organizer to publish a drive.');
  } catch (error) {
    if (!isCurrent(ctx)) return;
    root.querySelector('#driveResults').innerHTML = `<div class="alert alert-error">${esc(error.message)}</div>`;
  }
}

export async function renderDriveDetail(root, ctx) {
  if (!isCurrent(ctx)) return;
  const id = ctx.params.id;
  root.innerHTML = `<section class="section"><a class="small" href="#/drives">← All drives</a>
    <div id="driveDetail"><div class="loading-screen">Loading drive…</div></div></section>`;
  try {
    const drive = await request('drive', 'GET', `/api/drives/${encodeURIComponent(id)}`, { auth: false });
    if (!isCurrent(ctx)) return;
    const map = Number.isFinite(drive.lat) && Number.isFinite(drive.lon)
      ? `<a class="btn btn-light btn-small" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${drive.lat}&mlon=${drive.lon}#map=16/${drive.lat}/${drive.lon}">Open map (OpenStreetMap)</a>` : '';
    root.querySelector('#driveDetail').innerHTML = `<div class="panel">
      <div class="panel-title"><div><h2>${esc(drive.title)}</h2><p class="muted">${statusBadge(drive.status)} · ${esc(drive.city)}</p></div>${map}</div>
      <div class="kv">
        <div><span>Date</span><strong>${formatDate(drive.date)}</strong></div>
        <div><span>Venue</span><strong>${esc(drive.venue)}</strong></div>
        <div><span>Organizer</span><strong>${esc(drive.organizerName || '—')}</strong></div>
      </div>
      <p class="mt">${esc(drive.description || 'No description provided.')}</p>
    </div>
    <div class="panel mt"><div class="panel-title"><h3>Available time slots</h3><span class="muted small">Seat counts update after every booking.</span></div>
      ${drive.slots && drive.slots.length ? `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Seats</th><th>Action</th></tr></thead><tbody>
        ${drive.slots.map((slot) => `<tr>
          <td><strong>${esc(slot.startTime)} – ${esc(slot.endTime)}</strong></td>
          <td>${Math.max(0, slot.capacity - slot.booked)} / ${slot.capacity} free</td>
          <td>${drive.status === 'scheduled'
            ? `<button class="btn btn-primary btn-small" data-book="${esc(slot.id)}" ${ctx.user && ctx.user.role === 'donor' ? '' : 'disabled'}>Book seat</button>`
            : '<span class="muted">Drive closed</span>'}</td></tr>`).join('')}
        </tbody></table></div>${ctx.user && ctx.user.role === 'donor' ? '' : infoText()}` : emptyState('No slots yet', 'The organizer has not added time slots to this drive.')}
    </div>`;

    root.querySelectorAll('[data-book]').forEach((button) => {
      button.onclick = async () => {
        const okPrompt = await confirmDialog('Reserve this seat?', 'We will check your eligibility and hold the seat for you.', 'Book seat');
        if (!okPrompt) return;
        button.disabled = true;
        try {
          await request('booking', 'POST', '/api/bookings', { body: { driveId: drive.id, slotId: button.dataset.book } });
          if (!isCurrent(ctx)) return;
          toast('Seat booked. Check your email for the confirmation.', 'success');
          await renderDriveDetail(root, ctx);
        } catch (error) {
          toast(error.message, 'error');
          button.disabled = false;
        }
      };
    });
  } catch (error) {
    if (!isCurrent(ctx)) return;
    root.querySelector('#driveDetail').innerHTML = `<div class="alert alert-error">${esc(error.message)}</div>`;
  }
}

function infoText() {
  return '<p class="small muted mt">Log in with a donor account to book a seat.</p>';
}
