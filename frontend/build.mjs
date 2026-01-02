import { build } from 'esbuild';
import { mkdir, copyFile } from 'fs/promises';
import { existsSync } from 'fs';

const outdir = 'assets/build';

async function run() {
  await mkdir(outdir, { recursive: true });
  // Bundle and minify main front scripts
  await build({
    entryPoints: [
      'script.js',
      'script_exam.js'
    ],
    outdir,
    bundle: true,
    minify: true,
    sourcemap: false,
    target: ['es2019'],
    format: 'iife',
    legalComments: 'none'
  });
  // Optionally copy styles (no css minify here to keep scope small)
  if (existsSync('styles.css')) {
    await mkdir('dist', { recursive: true });
    await copyFile('styles.css', 'dist/styles.css');
  }
  console.log('Frontend build completed at', outdir);
}

run().catch((err) => { console.error(err); process.exit(1); });
