import { request } from '../api.js';
import { esc, formatDate, statusBadge, emptyState, toast, confirmDialog, formValue } from '../ui.js';

export async function renderOrganizer(root, ctx) {
  root.innerHTML = `<section class="section">
    <div class="panel-title"><div><h2>Organizer dashboard</h2><p class="muted">Create drives, manage slots, check in donors and follow turnout.</p></div>
      <button class="btn btn-primary" id="toggleCreate">+ New drive</button></div>
    <div id="createPanel" hidden class="panel">
      <div class="panel-title"><h3>Publish a donation drive</h3></div>
      <form id="createDriveForm" class="stack">
        <div class="form-grid">
          <div class="field"><label for="title">Title</label><input id="title" name="title" required minlength="3" /></div>
          <div class="field"><label for="city">City</label><input id="city" name="city" required /></div>
          <div class="field"><label for="venue">Venue</label><input id="venue" name="venue" required /></div>
          <div class="field"><label for="date">Date</label><input id="date" name="date" type="date" required /></div>
        </div>
        <div class="field"><label for="description">Description</label><textarea id="description" name="description" rows="2"></textarea></div>
        <button class="btn btn-primary" type="submit">Publish drive</button>
      </form>
    </div>
    <div id="organizerBody" class="mt"><div class="loading-screen">Loading your drives…</div></div>
  </section>`;

  const createPanel = root.querySelector('#createPanel');
  root.querySelector('#toggleCreate').onclick = () => { createPanel.hidden = !createPanel.hidden; };

  let selectedId = null;
  let tab = 'slots';

  async function loadDrives() {
    const data = await request('drive', 'GET', '/api/drives');
    return data.drives.filter((drive) => drive.organizerId === ctx.user.id);
  }

  async function renderBody() {
    const body = root.querySelector('#organizerBody');
    try {
      const drives = await loadDrives();
      if (!drives.length) {
        body.innerHTML = emptyState('You have not published a drive yet', 'Use “New drive” to create your first drive, then add time slots.');
        return;
      }
      if (!selectedId || !drives.some((drive) => drive.id === selectedId)) selectedId = drives[0].id;
      const drive = drives.find((item) => item.id === selectedId);
      body.innerHTML = `<div class="grid grid-2">
        <div class="panel"><div class="panel-title"><h3>Your drives</h3><span class="small muted">${drives.length} total</span></div>
          <div class="stack">${drives.map((item) => `<div class="timeline-item" style="display:block">
            <div style="display:flex;justify-content:space-between;gap:8px"><strong>${esc(item.title)}</strong>${statusBadge(item.status)}</div>
            <div class="small muted">${formatDate(item.date)} · ${esc(item.city)}</div>
            <div class="card-actions mt"><button class="btn btn-light btn-small" data-select="${esc(item.id)}">Manage</button>
              ${item.status === 'scheduled' ? `<button class="btn btn-danger btn-small" data-cancel-drive="${esc(item.id)}">Cancel drive</button>` : ''}
              ${item.status === 'cancelled' ? `<button class="btn btn-danger btn-small" data-delete-drive="${esc(item.id)}">Delete</button>` : ''}</div>
          </div>`).join('')}</div>
        </div>
        <div class="panel"><div class="panel-title"><div><h3>${esc(drive.title)}</h3>
            <p class="muted small">${formatDate(drive.date)} · ${esc(drive.venue)}</p></div></div>
          <div class="card-actions">
            <button class="btn btn-small ${tab === 'slots' ? 'btn-primary' : 'btn-light'}" data-tab="slots">Slots</button>
            <button class="btn btn-small ${tab === 'bookings' ? 'btn-primary' : 'btn-light'}" data-tab="bookings">Bookings</button>
            <button class="btn btn-small ${tab === 'report' ? 'btn-primary' : 'btn-light'}" data-tab="report">Report</button>
            <button class="btn btn-small ${tab === 'emails' ? 'btn-primary' : 'btn-light'}" data-tab="emails">Emails</button>
          </div>
          <div id="tabBody" class="mt"></div>
        </div>
      </div>`;

      body.querySelectorAll('[data-select]').forEach((button) => { button.onclick = () => { selectedId = button.dataset.select; renderBody(); }; });
      body.querySelectorAll('[data-tab]').forEach((button) => { button.onclick = () => { tab = button.dataset.tab; renderBody(); }; });
      body.querySelectorAll('[data-cancel-drive]').forEach((button) => { button.onclick = async () => {
        const yes = await confirmDialog('Cancel this drive?', 'All bookings will be cancelled, seats released and donors notified.', 'Cancel drive');
        if (!yes) return;
        try {
          await request('drive', 'PATCH', `/api/drives/${button.dataset.cancelDrive}/status`, { body: { status: 'cancelled' } });
          toast('Drive cancelled and donors notified.', 'success');
          await renderBody();
        } catch (error) { toast(error.message, 'error'); }
      }; });
      body.querySelectorAll('[data-delete-drive]').forEach((button) => { button.onclick = async () => {
        const yes = await confirmDialog('Delete this drive?', 'Permanently removes the drive and its slots.', 'Delete');
        if (!yes) return;
        try {
          await request('drive', 'DELETE', `/api/drives/${button.dataset.deleteDrive}`);
          toast('Drive deleted.', 'success');
          selectedId = null;
          await renderBody();
        } catch (error) { toast(error.message, 'error'); }
      }; });

      await renderTab(body.querySelector('#tabBody'), drive);
    } catch (error) {
      body.innerHTML = `<div class="alert alert-error">${esc(error.message)}</div>`;
    }
  }

  async function renderTab(container, drive) {
    if (tab === 'slots') {
      container.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Booked</th><th></th></tr></thead><tbody>
        ${drive.slots.length ? drive.slots.map((slot) => `<tr><td>${esc(slot.startTime)} – ${esc(slot.endTime)}</td>
          <td>${slot.booked} / ${slot.capacity}</td>
          <td><button class="btn btn-danger btn-small" data-delete-slot="${esc(slot.id)}" ${slot.booked ? 'disabled' : ''}>Delete</button></td></tr>`).join('')
          : '<tr><td colspan="3" class="muted">No slots yet.</td></tr>'}
        </tbody></table></div>
        <form id="slotForm" class="form-grid mt">
          <div class="field"><label>Start</label><input name="startTime" type="time" required /></div>
          <div class="field"><label>End</label><input name="endTime" type="time" required /></div>
          <div class="field"><label>Capacity</label><input name="capacity" type="number" min="1" max="200" value="10" required /></div>
          <div class="field"><label>&nbsp;</label><button class="btn btn-primary" type="submit">Add slot</button></div>
        </form>`;
      container.querySelector('#slotForm').onsubmit = async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        try {
          await request('drive', 'POST', `/api/drives/${drive.id}/slots`, {
            body: { startTime: formValue(form, 'startTime'), endTime: formValue(form, 'endTime'), capacity: Number(formValue(form, 'capacity')) }
          });
          toast('Time slot added.', 'success');
          await renderBody();
        } catch (error) { toast(error.message, 'error'); }
      };
      container.querySelectorAll('[data-delete-slot]').forEach((button) => { button.onclick = async () => {
        try {
          await request('drive', 'DELETE', `/api/drives/${drive.id}/slots/${button.dataset.deleteSlot}`);
          toast('Slot deleted.', 'success');
          await renderBody();
        } catch (error) { toast(error.message, 'error'); }
      }; });
    }

    if (tab === 'bookings') {
      container.innerHTML = '<div class="loading-screen">Loading bookings…</div>';
      try {
        const data = await request('booking', 'GET', `/api/bookings?driveId=${encodeURIComponent(drive.id)}`);
        container.innerHTML = data.count ? `<div class="table-wrap"><table><thead><tr><th>Donor</th><th>Slot</th><th>Status</th><th></th></tr></thead><tbody>
          ${data.bookings.map((booking) => `<tr><td>${esc(booking.donorName)}<br><span class="small muted">${esc(booking.bloodType || '')}</span></td>
            <td>${esc(booking.startTime)} – ${esc(booking.endTime)}</td><td>${statusBadge(booking.status)}</td>
            <td>${booking.status === 'confirmed' ? `<div class="card-actions">
              <button class="btn btn-primary btn-small" data-check="${esc(booking.id)}" data-outcome="attended">Attended</button>
              <button class="btn btn-light btn-small" data-check="${esc(booking.id)}" data-outcome="no_show">No-show</button></div>` : '—'}</td></tr>`).join('')}
          </tbody></table></div>` : emptyState('No bookings yet', 'Donors will appear here after they book a slot.');
        container.querySelectorAll('[data-check]').forEach((button) => { button.onclick = async () => {
          try {
            await request('booking', 'PATCH', `/api/bookings/${button.dataset.check}/check-in`, { body: { outcome: button.dataset.outcome } });
            toast(button.dataset.outcome === 'attended' ? 'Attendance and donation recorded.' : 'Marked as no-show.', 'success');
            await renderBody();
          } catch (error) { toast(error.message, 'error'); }
        }; });
      } catch (error) { container.innerHTML = `<div class="alert alert-error">${esc(error.message)}</div>`; }
    }

    if (tab === 'report') {
      container.innerHTML = `<p class="muted small">The report combines your slots with live booking counts and can be saved as a snapshot.</p>
        <button class="btn btn-primary" id="makeReport">Generate turnout report</button><div id="reportOut" class="mt"></div>`;
      container.querySelector('#makeReport').onclick = async () => {
        try {
          const report = await request('drive', 'GET', `/api/drives/${drive.id}/report`);
          container.querySelector('#reportOut').innerHTML = `<div class="panel"><div class="kv">
            <div><span>Capacity</span><strong>${report.capacity}</strong></div>
            <div><span>Booked</span><strong>${report.booked}</strong></div>
            <div><span>Attended</span><strong>${report.attended}</strong></div>
            <div><span>Fill rate</span><strong>${report.fillRate}%</strong></div>
            <div><span>Turnout rate</span><strong>${report.turnoutRate}%</strong></div>
            <div><span>No-show rate</span><strong>${report.noShowRate}%</strong></div></div>
            <p class="small muted mt">Snapshot ${esc(report.storage)}: ${esc(report.location)}</p></div>`;
          toast('Report generated and saved.', 'success');
        } catch (error) { toast(error.message, 'error'); }
      };
    }

    if (tab === 'emails') {
      container.innerHTML = `<div class="alert alert-info">Send a reminder to everyone booked for a chosen date. Duplicate sends are prevented by the database.</div>
        <form id="reminderForm" class="field"><label>Reminder date</label><input name="date" type="date" value="${drive.date}" required />
        <button class="btn btn-primary mt" type="submit">Send reminder emails</button></form><div id="reminderOut" class="mt"></div>`;
      container.querySelector('#reminderForm').onsubmit = async (event) => {
        event.preventDefault();
        try {
          const result = await request('booking', 'POST', '/api/reminders/send', { body: { date: formValue(event.currentTarget, 'date') } });
          toast(`Reminders: ${result.sent} sent, ${result.skipped} skipped, ${result.failed} failed.`, 'success');
        } catch (error) { toast(error.message, 'error'); }
      };
      try {
        const log = await request('booking', 'GET', '/api/reminders');
        container.querySelector('#reminderOut').innerHTML = log.count ? `<div class="table-wrap"><table><thead><tr><th>To</th><th>Type</th><th>Status</th></tr></thead><tbody>
          ${log.reminders.slice(0, 12).map((row) => `<tr><td>${esc(row.to)}</td><td>${esc(row.type)}</td><td>${statusBadge(row.status)}</td></tr>`).join('')}
          </tbody></table></div>` : emptyState('No emails yet', 'Confirmations and reminders are logged here.');
      } catch (error) { container.querySelector('#reminderOut').innerHTML = `<div class="alert alert-error">${esc(error.message)}</div>`; }
    }
  }

  root.querySelector('#createDriveForm').onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const created = await request('drive', 'POST', '/api/drives', { body: {
        title: formValue(form, 'title'), venue: formValue(form, 'venue'), city: formValue(form, 'city'),
        date: formValue(form, 'date'), description: formValue(form, 'description')
      } });
      toast('Drive published. Now add time slots.', 'success');
      form.reset();
      createPanel.hidden = true;
      selectedId = created.id;
      tab = 'slots';
      await renderBody();
    } catch (error) { toast(error.message, 'error'); }
  };

  await renderBody();
}
