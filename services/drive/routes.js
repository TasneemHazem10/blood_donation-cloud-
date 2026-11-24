'use strict';

const { route } = require('../../shared/router');
const c = require('./controllers/drives');

module.exports = [
  route('GET', '/api/health/drive', c.health),
  route('GET', '/api/drives', c.listDrives),
  route('POST', '/api/drives', c.createDrive, { auth: true, roles: ['organizer'] }),
  route('GET', '/api/drives/:id', c.getDrive),
  route('PUT', '/api/drives/:id', c.updateDrive, { auth: true, roles: ['organizer'] }),
  route('PATCH', '/api/drives/:id/status', c.changeStatus, { auth: true, roles: ['organizer'] }),
  route('DELETE', '/api/drives/:id', c.deleteDrive, { auth: true, roles: ['organizer'] }),
  route('POST', '/api/drives/:id/slots', c.createSlot, { auth: true, roles: ['organizer'] }),
  route('PUT', '/api/drives/:id/slots/:slotId', c.updateSlot, { auth: true, roles: ['organizer'] }),
  route('DELETE', '/api/drives/:id/slots/:slotId', c.deleteSlot, { auth: true, roles: ['organizer'] }),
  route('GET', '/api/drives/:id/report', c.getReport, { auth: true, roles: ['organizer'] }),
  route('GET', '/api/drives/:id/reports', c.listReports, { auth: true, roles: ['organizer'] }),

  route('GET', '/internal/drives/:id', c.internalGetDrive, { internal: true }),
  route('POST', '/internal/drives/:id/slots/:slotId/reservation', c.reserveSeat, { internal: true }),
  route('DELETE', '/internal/drives/:id/slots/:slotId/reservation', c.releaseSeat, { internal: true })
];
