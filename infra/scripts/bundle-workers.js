'use strict';

// Bundles each service's Cloudflare Worker entry point into one small file.
const esbuild = require('esbuild');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '../..');

(async () => {
  for (const service of ['drive', 'donor', 'booking']) {
    const outfile = path.join(root, 'services', service, 'dist', 'worker.js');
    fs.mkdirSync(path.dirname(outfile), { recursive: true });
    await esbuild.build({
      entryPoints: [path.join(root, 'services', service, 'worker.js')],
      outfile,
      bundle: true,
      minify: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      // The S3 adapter is Node/AWS-only. Workers store reports in Neon, so a
      // tiny stub replaces it and keeps the AWS SDK out of the bundle.
      plugins: service === 'drive' ? [{
        name: 'worker-s3-stub',
        setup(build) {
          build.onResolve({ filter: /(^|\/)s3(\.js)?$/ }, () => ({
            path: path.join(root, 'services', 'drive', 'services', 's3-worker.js')
          }));
        }
      }] : [],
      logLevel: 'warning'
    });
    console.log(`Bundled ${service} worker -> services/${service}/dist/worker.js`);
  }
})().catch((error) => { console.error(error); process.exit(1); });
