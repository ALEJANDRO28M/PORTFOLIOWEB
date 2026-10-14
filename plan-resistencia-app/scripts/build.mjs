// Empaqueta la app web en www/ (lo que Capacitor mete dentro del APK).
import { build } from 'esbuild';
import { mkdirSync, copyFileSync, rmSync } from 'node:fs';

rmSync('www', { recursive: true, force: true });
mkdirSync('www', { recursive: true });
await build({
  entryPoints: { app: 'src/main.ts' },
  bundle: true, minify: true, format: 'iife', target: ['chrome90'], outdir: 'www', jsx: 'transform',
  loader: { '.woff2': 'file', '.woff': 'file' }, assetNames: 'fonts/[name]-[hash]', charset: 'utf8',
  define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'info',
});
copyFileSync('src/index.html', 'www/index.html');
