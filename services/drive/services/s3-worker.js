'use strict';

// Cloudflare Workers do not write report snapshots to S3. Reports are stored
// in bdo_reports (Neon) and this stub keeps the AWS SDK out of the Worker bundle.
async function saveReportSnapshot(report) {
  return { storage: 'database', location: `report:${report.id || report.driveId}` };
}

module.exports = { saveReportSnapshot };
