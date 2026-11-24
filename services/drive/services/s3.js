'use strict';

// Only used on Floci/AWS: stores a CSV snapshot of each generated report.
const { config } = require('../../../shared/config');

async function saveReportSnapshot(report) {
  const settings = config();
  if (!settings.reportsBucket) return { storage: 'database', location: `report:${report.id}` };
  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
  const client = new S3Client({
    region: settings.awsRegion,
    // Emulators such as Floci/MinIO do not support bucket-name virtual hosts.
    forcePathStyle: Boolean(settings.awsEndpoint),
    ...(settings.awsEndpoint ? { endpoint: settings.awsEndpoint } : {})
  });
  const csv = [
    'field,value',
    ...Object.entries(report).map(([key, value]) => `${key},${String(value).replace(/,/g, ' ')}`)
  ].join('\n');
  const key = `reports/${report.driveId}/${report.id}.csv`;
  await client.send(new PutObjectCommand({
    Bucket: settings.reportsBucket,
    Key: key,
    Body: csv,
    ContentType: 'text/csv'
  }));
  return { storage: 's3', location: `s3://${settings.reportsBucket}/${key}` };
}

module.exports = { saveReportSnapshot };
