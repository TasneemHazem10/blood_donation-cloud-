'use strict';

// Bundles each Express service into a single Lambda file, then zips it.
// Bundling avoids uploading thousands of node_modules files and never includes .env.
const esbuild = require('esbuild');
const archiver = require('archiver');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

(async () => {
  fs.mkdirSync(path.join(root, 'dist', 'lambda'), { recursive: true });
  for (const service of ['drive', 'donor', 'booking']) {
    const folder = path.join(root, 'dist', 'lambda', service);
    fs.mkdirSync(folder, { recursive: true });
    const entry = path.join(root, 'services', service, 'lambda.js');
    await esbuild.build({
      entryPoints: [entry],
      outfile: path.join(folder, 'lambda.js'),
      bundle: true,
      minify: true,
      platform: 'node',
      format: 'cjs',
      target: 'node24',
      logLevel: 'warning'
    });

    const zipPath = path.join(root, 'dist', 'lambda', `${service}.zip`);
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      // Lab 7 names the package entry file lambda.js and the handler lambda.handler.
      archive.file(path.join(folder, 'lambda.js'), { name: 'lambda.js' });
      archive.finalize();
    });
    console.log(`Lambda package: dist/lambda/${service}.zip (handler lambda.handler)`);
  }
})().catch((error) => { console.error(error); process.exit(1); });
