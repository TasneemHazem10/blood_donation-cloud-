import { request, clearSession } from '../api.js';
import { esc, formatDate, statusBadge, emptyState, toast, confirmDialog, formValue, isCurrent } from '../ui.js';

export async function renderProfile(root, ctx) {
  root.innerHTML = `<section class="section"><div class="panel-title"><div><h2>My donor profile</h2>
    <p class="muted">Your eligibility is calculated by the Donor service from these details.</p></div></div>
    <div id="profileBody"><div class="loading-screen">Loading profile…</div></div></section>`;
  try {
    const [profile, eligibility, history] = await Promise.all([
      request('donor', 'GET', '/api/donors/me'),
      request('donor', 'GET', '/api/donors/me/eligibility'),
      request('donor', 'GET', '/api/donors/me/donations')
    ]);
    if (!isCurrent(ctx)) return;
    const donor = profile.donor;
    const bannerClass = eligibility.eligible ? 'alert-success' : 'alert-info';
    root.querySelector('#profileBody').innerHTML = `<div class="alert ${bannerClass}">
        <strong>${eligibility.eligible ? 'You can donate today.' : 'Not eligible yet.'}</strong>
        ${esc(eligibility.reason)}
        ${eligibility.nextEligibleDate ? ` Next eligible date: <strong>${formatDate(eligibility.nextEligibleDate)}</strong>.` : ''}</div>
      <div class="grid grid-2">
        <div class="panel"><div class="panel-title"><h3>Donation details</h3></div>
          <form id="profileForm" class="stack">
            <div class="form-grid">
              <div class="field"><label for="bloodType">Blood type</label><select id="bloodType" name="bloodType">
                ${['A+','A-','B+','B-','AB+','AB-','O+','O-'].map((type) =>
                  `<option value="${type}" ${donor.bloodType === type ? 'selected' : ''}>${type}</option>`).join('')}</select></div>
              <div class="field"><label for="weightKg">Weight (kg)</label><input id="weightKg" name="weightKg" type="number" min="30" max="300" value="${esc(donor.weightKg || '')}" /></div>
              <div class="field"><label for="birthYear">Birth year</label><input id="birthYear" name="birthYear" type="number" min="1900" max="${new Date().getFullYear()}" value="${esc(donor.birthYear || '')}" /></div>
              <div class="field"><label for="phone">Phone</label><input id="phone" name="phone" value="${esc(donor.phone || '')}" /></div>
            </div>
            <button class="btn btn-primary" type="submit">Save changes</button>
          </form>
          <div class="kv mt"><div><span>Last donation</span><strong>${formatDate(donor.lastDonationDate)}</strong></div>
            <div><span>Total donations</span><strong>${history.count}</strong></div></div>
        </div>
        <div class="panel"><div class="panel-title"><h3>Donation history</h3></div>
          ${history.count ? `<div class="timeline">${history.donations.map((item) => `<div class="timeline-item">
            <span>${formatDate(item.date)}</span><span class="small muted">${esc(item.driveId)}</span></div>`).join('')}</div>`
            : emptyState('No donations recorded', 'Your donations appear here after an organizer checks you in.')}
        </div>
      </div>
      <div class="panel mt"><div class="panel-title"><div><h3>Account</h3><p class="muted small">Deletion is blocked while you have an active booking.</p></div>
        <button class="btn btn-danger btn-small" id="deleteAccount">Delete my account</button></div></div>`;

    root.querySelector('#profileForm').onsubmit = async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      try {
        await request('donor', 'PUT', '/api/donors/me', { body: {
          bloodType: form.elements.bloodType.value,
          weightKg: Number(formValue(form, 'weightKg')),
          birthYear: Number(formValue(form, 'birthYear')),
          phone: formValue(form, 'phone')
        } });
        if (!isCurrent(ctx)) return;
        toast('Profile saved. Eligibility has been recalculated.', 'success');
        await renderProfile(root, ctx);
      } catch (error) { toast(error.message, 'error'); }
    };
    root.querySelector('#deleteAccount').onclick = async () => {
      const confirmed = await confirmDialog('Delete account?', 'This cannot be undone. Active bookings must be cancelled first.', 'Yes, delete');
      if (!confirmed) return;
      try {
        await request('donor', 'DELETE', '/api/donors/me');
        if (!isCurrent(ctx)) return;
        clearSession();
        window.dispatchEvent(new Event('bdo:session'));
        toast('Your account was deleted.', 'success');
        ctx.navigate('#/');
      } catch (error) { toast(error.message, 'error'); }
    };
  } catch (error) {
    if (!isCurrent(ctx)) return;
    root.querySelector('#profileBody').innerHTML = `<div class="alert alert-error">${esc(error.message)}</div>`;
  }
}

export async function renderBookings(root, ctx) {
  root.innerHTML = `<section class="section"><div class="panel-title"><div><h2>My bookings</h2>
    <p class="muted">Live from the Booking service. Cancelling releases your seat immediately.</p></div>
    <a class="btn btn-light btn-small" href="#/drives">Find another drive</a></div>
    <div id="bookingsBody"><div class="loading-screen">Loading bookings…</div></div></section>`;
  try {
    const data = await request('booking', 'GET', '/api/bookings/mine');
    if (!isCurrent(ctx)) return;
    root.querySelector('#bookingsBody').innerHTML = data.count
      ? `<div class="panel table-wrap"><table><thead><tr><th>Drive</th><th>Date & time</th><th>Status</th><th></th></tr></thead><tbody>
        ${data.bookings.map((booking) => `<tr>
          <td><strong>${esc(booking.driveTitle)}</strong><br><span class="small muted">${esc(booking.venue)}</span></td>
          <td>${formatDate(booking.driveDate)}<br><span class="small muted">${esc(booking.startTime)} – ${esc(booking.endTime)}</span></td>
          <td>${statusBadge(booking.status)}</td>
          <td>${booking.status === 'confirmed'
            ? `<button class="btn btn-danger btn-small" data-cancel="${esc(booking.id)}">Cancel</button>` : '—'}</td></tr>`).join('')}
        </tbody></table></div>`
      : emptyState('No bookings yet', 'Browse the drives and reserve a time slot to see it here.', '<a class="btn btn-primary" href="#/drives">Find a drive</a>');

    root.querySelectorAll('[data-cancel]').forEach((button) => {
      button.onclick = async () => {
        const confirmed = await confirmDialog('Cancel this booking?', 'Your seat will be released for another donor.', 'Cancel booking');
        if (!confirmed) return;
        button.disabled = true;
        try {
          await request('booking', 'POST', `/api/bookings/${encodeURIComponent(button.dataset.cancel)}/cancel`, { body: {} });
          if (!isCurrent(ctx)) return;
          toast('Booking cancelled. The seat is available again.', 'success');
          await renderBookings(root, ctx);
        } catch (error) { toast(error.message, 'error'); button.disabled = false; }
      };
    });
  } catch (error) {
    if (!isCurrent(ctx)) return;
    root.querySelector('#bookingsBody').innerHTML = `<div class="alert alert-error">${esc(error.message)}</div>`;
  }
}
