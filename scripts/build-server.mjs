import { URL } from "node:url";
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
const manifest = JSON.parse(readFileSync(new URL('../apps/server/package.json', import.meta.url), 'utf8'));
await build({
  entryPoints: ['apps/server/src/cloud/handler.ts'],
  outfile: 'apps/server/dist/cloud.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: Object.keys(manifest.dependencies).filter((name) => !name.startsWith('@wyckoff/')),
});
