import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
cpSync('static', 'dist', { recursive: true });

await build({
  entryPoints: ['src/offscreen.ts'],
  outfile: 'dist/offscreen.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  sourcemap: true,
  logLevel: 'info',
});
