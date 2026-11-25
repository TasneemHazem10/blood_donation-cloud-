'use strict';

const { getStore, now } = require('../../../shared/context');
const { newId } = require('../../../shared/crypto');
const { badRequest, conflict, unavailable } = require('../../../shared/errors');
const { ok, created, noContent } = require('../../../shared/http');
const { idParam, dateField } = require('../../../shared/validate');
const { geocode } = require('../../../shared/external/geo');
const { callService } = require('../../../shared/serviceClient');
const { saveReportSnapshot } = require('../services/s3');
const rules = require('../services/driveRules');

const store = () => getStore();

async function slotsFor(driveId) {
  return (await store().search('bdo_slots', 'driveId', driveId))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

function withSlotSummary(drive, slots) {
  return {
    ...drive,
    slots: slots.map((slot) => ({ ...slot, available: Math.max(0, slot.capacity - slot.booked) }))
  };
}

async function listDrives(ctx) {
  const query = ctx.query || {};
  let drives = rules.filterDrives(await store().all('bdo_drives'), query);
  if (query.near) {
    const point = await geocode(String(query.near));
    if (!point) throw unavailable('Could not locate that place. Try a city name.');
    drives = rules.filterNear(drives, point, query.radius);
    drives.sort((a, b) => a.distanceKm - b.distanceKm);
  } else {
    drives.sort((a, b) => a.date.localeCompare(b.date));
  }
  const allSlots = await store().all('bdo_slots');
  return ok({
    count: drives.length,
    drives: drives.map((drive) => withSlotSummary(drive, allSlots.filter((slot) => slot.driveId === drive.id)))
  });
}

async function getDrive(ctx) {
  const id = idParam(ctx.params);
  const drive = rules.requireDrive(await store().get('bdo_drives', id));
  return ok(withSlotSummary(drive, await slotsFor(id)));
}

async function createDrive(ctx) {
  const input = rules.validateDriveInput(ctx.body || {});
  const user = ctx.user;
  const place = `${input.venue}, ${input.city}`;
  const point = await geocode(place);
  const drive = {
    id: newId('drv'),
    ...input,
    organizerId: user.id,
    organizerName: user.name || user.email,
    status: 'scheduled',
    lat: point ? point.lat : null,
    lon: point ? point.lon : null,
    locationLabel: point ? point.label : place,
    createdAt: now()
  };
  await store().put('bdo_drives', drive);
  return created(drive);
}

async function updateDrive(ctx) {
  const id = idParam(ctx.params);
  const drive = rules.requireDrive(await store().get('bdo_drives', id));
  rules.assertOwner(drive, ctx.user);
  rules.assertEditable(drive);
  const input = rules.validateDriveInput({ ...drive, ...(ctx.body || {}) });
  const addressChanged = input.venue !== drive.venue || input.city !== drive.city;
  let point = { lat: drive.lat, lon: drive.lon, label: drive.locationLabel };
  if (addressChanged) point = await geocode(`${input.venue}, ${input.city}`) || { lat: null, lon: null, label: '' };
  const updated = await store().update('bdo_drives', id, {
    ...input,
    lat: point.lat,
    lon: point.lon,
    locationLabel: point.label
  });
  return ok(updated);
}

async function changeStatus(ctx) {
  const id = idParam(ctx.params);
  const status = ctx.body && ctx.body.status;
  if (!rules.STATUSES.includes(status)) throw badRequest('status must be scheduled, cancelled or completed');
  const drive = rules.requireDrive(await store().get('bdo_drives', id));
  rules.assertOwner(drive, ctx.user);
  if (drive.status !== 'scheduled') throw conflict('Only a scheduled drive can change status');
  if (status === 'scheduled') throw conflict('Drive is already scheduled');
  if (status === 'completed' && drive.date > new Date().toISOString().slice(0, 10)) {
    throw conflict('A future drive cannot be completed');
  }
  // Flip the drive first with a CAS. Side effects run afterwards so a slow or
  // unavailable booking service cannot leave a cancelled drive still bookable.
  const updated = await store().cas('bdo_drives', id, { status, statusChangedAt: now() }, { status: 'scheduled' });
  if (!updated) throw conflict('Drive status changed. Please refresh and try again.');
  if (status === 'cancelled') {
    await callService('booking', 'POST', `/internal/drives/${id}/cancellations`, { body: {} })
      .catch((error) => console.error('DRIVE_CANCEL_BOOKINGS_FAILED', error.message));
    const slots = await slotsFor(id);
    for (const slot of slots) await store().update('bdo_slots', slot.id, { booked: 0 });
  }
  return ok(updated);
}

async function deleteDrive(ctx) {
  const id = idParam(ctx.params);
  const drive = rules.requireDrive(await store().get('bdo_drives', id));
  rules.assertOwner(drive, ctx.user);
  const stats = await callService('booking', 'GET', `/internal/drives/${id}/stats`);
  // booked includes confirmed, attended and no-show rows; deleting any of them
  // would orphan reports and donations.
  if (stats.booked > 0) throw conflict('Cancel or remove all bookings before deleting this drive');
  for (const slot of await slotsFor(id)) await store().remove('bdo_slots', slot.id);
  for (const report of await store().search('bdo_reports', 'driveId', id)) await store().remove('bdo_reports', report.id);
  await store().remove('bdo_drives', id);
  return noContent();
}

async function createSlot(ctx) {
  const driveId = idParam(ctx.params);
  const drive = rules.requireDrive(await store().get('bdo_drives', driveId));
  rules.assertOwner(drive, ctx.user);
  rules.assertEditable(drive);
  const input = rules.validateSlotInput(ctx.body || {});
  const slots = await slotsFor(driveId);
  rules.assertNoOverlap(slots, input);
  const slot = { id: newId('slt'), driveId, ...input, booked: 0, createdAt: now() };
  await store().put('bdo_slots', slot);
  return created(slot);
}

async function updateSlot(ctx) {
  const driveId = idParam(ctx.params);
  const slotId = idParam(ctx.params, 'slotId');
  const drive = rules.requireDrive(await store().get('bdo_drives', driveId));
  rules.assertOwner(drive, ctx.user);
  rules.assertEditable(drive);
  const slot = await store().get('bdo_slots', slotId);
  if (!slot || slot.driveId !== driveId) throw conflict('Slot not found on this drive');
  const merged = { ...slot, ...(ctx.body || {}) };
  const input = rules.validateSlotInput(merged);
  if (input.capacity < slot.booked) throw conflict(`Capacity cannot be lower than ${slot.booked} booked seats`);
  const others = (await slotsFor(driveId)).filter((item) => item.id !== slotId);
  rules.assertNoOverlap(others, input);
  return ok(await store().update('bdo_slots', slotId, input));
}

async function deleteSlot(ctx) {
  const driveId = idParam(ctx.params);
  const slotId = idParam(ctx.params, 'slotId');
  const drive = rules.requireDrive(await store().get('bdo_drives', driveId));
  rules.assertOwner(drive, ctx.user);
  rules.assertEditable(drive);
  const slot = await store().get('bdo_slots', slotId);
  if (!slot || slot.driveId !== driveId) throw conflict('Slot not found on this drive');
  if (slot.booked > 0) throw conflict('A slot with bookings cannot be deleted');
  await store().remove('bdo_slots', slotId);
  return noContent();
}

async function getReport(ctx) {
  const driveId = idParam(ctx.params);
  const drive = rules.requireDrive(await store().get('bdo_drives', driveId));
  rules.assertOwner(drive, ctx.user);
  const stats = await callService('booking', 'GET', `/internal/drives/${driveId}/stats`);
  const report = rules.buildReport(drive, await slotsFor(driveId), stats);
  // The S3 key needs the report id, so generate it before taking the snapshot.
  const saved = { id: newId('rpt'), driveId, ...report };
  const storage = await saveReportSnapshot(saved);
  const stored = { ...saved, ...storage };
  await store().put('bdo_reports', stored);
  return ok(stored);
}

async function listReports(ctx) {
  const driveId = idParam(ctx.params);
  const drive = rules.requireDrive(await store().get('bdo_drives', driveId));
  rules.assertOwner(drive, ctx.user);
  const reports = (await store().search('bdo_reports', 'driveId', driveId))
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  return ok({ count: reports.length, reports });
}

// Internal endpoints called by the Booking service.
async function internalGetDrive(ctx) {
  const id = idParam(ctx.params);
  const drive = rules.requireDrive(await store().get('bdo_drives', id));
  return ok(withSlotSummary(drive, await slotsFor(id)));
}

async function reserveSeat(ctx) {
  const { id: driveId, slotId } = ctx.params;
  idParam(ctx.params, 'slotId');
  const drive = rules.requireDrive(await store().get('bdo_drives', driveId));
  if (drive.status !== 'scheduled') throw conflict('Drive is not open for bookings');
  const slot = await store().get('bdo_slots', slotId);
  if (!slot || slot.driveId !== driveId) throw conflict('Slot not found on this drive');
  const updated = await store().reserveSeat(slotId, 1);
  if (!updated) throw conflict('This slot is full');
  return ok(updated);
}

async function releaseSeat(ctx) {
  const { id: driveId, slotId } = ctx.params;
  idParam(ctx.params, 'slotId');
  const slot = await store().get('bdo_slots', slotId);
  if (!slot || slot.driveId !== driveId) throw conflict('Slot not found on this drive');
  const updated = await store().reserveSeat(slotId, -1);
  if (!updated) throw conflict('Seat count cannot go below zero');
  return ok(updated);
}

async function internalStats(ctx) {
  const id = idParam(ctx.params);
  return ok(await callService('booking', 'GET', `/internal/drives/${id}/stats`));
}

async function internalCancellations(ctx) {
  const id = idParam(ctx.params);
  return ok(await callService('booking', 'POST', `/internal/drives/${id}/cancellations`, { body: ctx.body || {} }));
}

async function health() {
  return ok({ status: 'ok', service: 'drive', time: now() });
}

module.exports = {
  listDrives, getDrive, createDrive, updateDrive, changeStatus, deleteDrive,
  createSlot, updateSlot, deleteSlot, getReport, listReports,
  internalGetDrive, reserveSeat, releaseSeat, internalStats, internalCancellations, health
};
