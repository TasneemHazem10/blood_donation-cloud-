'use strict';

// Floci / real AWS data layer. Tables are created by infra/services/*.sh.
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand, PutCommand, UpdateCommand, DeleteCommand, ScanCommand
} = require('@aws-sdk/lib-dynamodb');
const { config } = require('../config');
const { assertTable } = require('./tables');

function createDynamoStore(options = {}) {
  const settings = config();
  const client = new DynamoDBClient({
    region: settings.awsRegion,
    ...(options.endpoint || settings.awsEndpoint ? { endpoint: options.endpoint || settings.awsEndpoint } : {}),
    credentials: options.credentials || {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test'
    }
  });
  const db = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });

  const isConditionalFailure = (error) => error && error.name === 'ConditionalCheckFailedException';

  return {
    driver: 'dynamo',
    async init() {},
    async get(table, id) {
      assertTable(table);
      const result = await db.send(new GetCommand({ TableName: table, Key: { id: String(id) } }));
      return result.Item || null;
    },
    async put(table, record) {
      assertTable(table);
      await db.send(new PutCommand({ TableName: table, Item: record }));
      return record;
    },
    async insert(table, record) {
      assertTable(table);
      try {
        await db.send(new PutCommand({
          TableName: table,
          Item: record,
          ConditionExpression: 'attribute_not_exists(id)'
        }));
        return record;
      } catch (error) {
        if (isConditionalFailure(error)) return null;
        throw error;
      }
    },
    async update(table, id, patch) {
      const current = await this.get(table, id);
      if (!current) return null;
      return this.put(table, { ...current, ...patch, updatedAt: patch.updatedAt || new Date().toISOString() });
    },
    async cas(table, id, patch, expected = {}) {
      assertTable(table);
      const names = {};
      const values = {};
      const assignments = [];
      const conditions = ['attribute_exists(id)'];
      let index = 0;
      for (const [field, value] of Object.entries({ ...patch, updatedAt: new Date().toISOString() })) {
        const name = `#p${index}`;
        const valueName = `:p${index}`;
        names[name] = field;
        values[valueName] = value;
        assignments.push(`${name} = ${valueName}`);
        index += 1;
      }
      for (const [field, value] of Object.entries(expected)) {
        const name = `#e${index}`;
        const valueName = `:e${index}`;
        names[name] = field;
        values[valueName] = value;
        conditions.push(`${name} = ${valueName}`);
        index += 1;
      }
      try {
        const result = await db.send(new UpdateCommand({
          TableName: table,
          Key: { id: String(id) },
          UpdateExpression: `SET ${assignments.join(', ')}`,
          ConditionExpression: conditions.join(' AND '),
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ReturnValues: 'ALL_NEW'
        }));
        return result.Attributes || null;
      } catch (error) {
        if (isConditionalFailure(error)) return null;
        throw error;
      }
    },
    async remove(table, id) {
      assertTable(table);
      const result = await db.send(new DeleteCommand({
        TableName: table, Key: { id: String(id) }, ReturnValues: 'ALL_OLD'
      }));
      return result.Attributes || null;
    },
    async all(table) {
      assertTable(table);
      const items = [];
      let key = undefined;
      do {
        const result = await db.send(new ScanCommand({ TableName: table, ExclusiveStartKey: key }));
        items.push(...(result.Items || []));
        key = result.LastEvaluatedKey;
      } while (key);
      return items;
    },
    async search(table, field, value) {
      return (await this.all(table)).filter((item) => item[field] === value);
    },
    // DynamoDB does not allow arithmetic in ConditionExpression, so read the
    // current count, check capacity locally, then update only if it is unchanged.
    // A competing writer fails the condition and is retried with the new value.
    async reserveSeat(slotKey, delta) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const current = await this.get('bdo_slots', String(slotKey));
        if (!current) return null;
        const expected = Number(current.booked) || 0;
        const next = expected + delta;
        if (next < 0 || next > (Number(current.capacity) || 0)) return null;
        try {
          const result = await db.send(new UpdateCommand({
            TableName: 'bdo_slots',
            Key: { id: String(slotKey) },
            UpdateExpression: 'SET booked = :next',
            ConditionExpression: 'attribute_exists(id) AND (attribute_not_exists(booked) OR booked = :expected)',
            ExpressionAttributeValues: { ':next': next, ':expected': expected },
            ReturnValues: 'ALL_NEW'
          }));
          return result.Attributes || null;
        } catch (error) {
          if (isConditionalFailure(error)) continue;
          throw error;
        }
      }
      return null;
    },
    async close() {}
  };
}

module.exports = { createDynamoStore };
