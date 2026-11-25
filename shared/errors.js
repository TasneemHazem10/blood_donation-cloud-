'use strict';

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code || `E${status}`;
  }
}

const badRequest = (message) => new HttpError(400, message, 'VALIDATION_ERROR');
const unauthorized = (message = 'Authentication required') => new HttpError(401, message, 'UNAUTHORIZED');
const forbidden = (message = 'You are not allowed to do that') => new HttpError(403, message, 'FORBIDDEN');
const notFound = (message = 'Record not found') => new HttpError(404, message, 'NOT_FOUND');
const conflict = (message) => new HttpError(409, message, 'CONFLICT');
const unavailable = (message = 'An external service is unavailable') => new HttpError(502, message, 'UPSTREAM_ERROR');
const payloadTooLarge = (message = 'Request body too large') => new HttpError(413, message, 'PAYLOAD_TOO_LARGE');

function toErrorBody(error) {
  // Express body-parser raises plain errors; translate them into the same
  // envelope that controllers and the Worker runtime already use.
  if (error && (error.type === 'entity.parse.failed' || (error.status === 400 && error instanceof SyntaxError))) {
    return { status: 400, body: { error: { code: 'VALIDATION_ERROR', message: 'Body must be valid JSON' } } };
  }
  if (error && (error.type === 'entity.too.large' || error.status === 413)) {
    return { status: 413, body: { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } } };
  }
  if (error instanceof HttpError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message } } };
  }
  console.error('UNHANDLED', error && error.stack ? error.stack : error);
  return { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } } };
}

module.exports = {
  HttpError, badRequest, unauthorized, forbidden, notFound, conflict, unavailable,
  payloadTooLarge, toErrorBody
};
