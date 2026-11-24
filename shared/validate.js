'use strict';

const { badRequest } = require('./errors');

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isEmail = (value) => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const isTime = (value) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

function requireBody(body) {
  if (!isObject(body)) throw badRequest('A JSON object body is required');
  return body;
}

function requireFields(body, fields) {
  requireBody(body);
  for (const field of fields) {
    if (body[field] === undefined || body[field] === null || String(body[field]).trim() === '') {
      throw badRequest(`${field} is required`);
    }
  }
  return body;
}

function stringField(body, field, { min = 1, max = 200, optional = false } = {}) {
  const value = body[field];
  if (value === undefined || value === null || value === '') {
    if (optional) return undefined;
    throw badRequest(`${field} is required`);
  }
  if (typeof value !== 'string') throw badRequest(`${field} must be text`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw badRequest(`${field} must be ${min}-${max} characters`);
  return trimmed;
}

function numberField(body, field, { min, max, integer = true, optional = false } = {}) {
  const value = body[field];
  if (value === undefined || value === null || value === '') {
    if (optional) return undefined;
    throw badRequest(`${field} is required`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || (integer && !Number.isInteger(number))) throw badRequest(`${field} must be a number`);
  if (min !== undefined && number < min) throw badRequest(`${field} must be at least ${min}`);
  if (max !== undefined && number > max) throw badRequest(`${field} must be at most ${max}`);
  return number;
}

function enumField(body, field, values, { optional = false } = {}) {
  const value = body[field];
  if (value === undefined || value === null || value === '') {
    if (optional) return undefined;
    throw badRequest(`${field} is required`);
  }
  if (!values.includes(value)) throw badRequest(`${field} must be one of: ${values.join(', ')}`);
  return value;
}

function emailField(body, field = 'email') {
  const value = stringField(body, field, { max: 254 }).toLowerCase();
  if (!isEmail(value)) throw badRequest(`${field} must be a valid email address`);
  return value;
}

function dateField(body, field, { optional = false } = {}) {
  const value = body[field];
  if (value === undefined || value === null || value === '') {
    if (optional) return undefined;
    throw badRequest(`${field} is required`);
  }
  if (!isDate(value)) throw badRequest(`${field} must be a date in YYYY-MM-DD format`);
  return value;
}

function idParam(params, name = 'id') {
  const value = params && params[name];
  if (!value || !/^[A-Za-z0-9_.@+-]{1,200}$/.test(String(value))) throw badRequest(`Invalid ${name}`);
  return value;
}

module.exports = {
  isObject, isEmail, isDate, isTime, requireBody, requireFields, stringField,
  numberField, enumField, emailField, dateField, idParam
};
