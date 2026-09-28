import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Import a source entry with the project's TS path alias, without a browser. */
export async function importBundled(entry, name) {
  const directory = resolve('node_modules/.cache/ripe-offline-tests');
  await mkdir(directory, { recursive: true });
  const outfile = resolve(directory, `${name}.mjs`);
  await build({ entryPoints: [resolve(entry)], outfile, bundle: true,
    packages: 'external', platform: 'node', format: 'esm', target: 'es2022',
    tsconfig: resolve('tsconfig.json'), logLevel: 'silent' });
  return import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
}
