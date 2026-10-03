// Bundles every src/handlers/<name>.ts into dist/<name>/index.mjs (one zip per Lambda).
import { build } from 'esbuild';
import { access, cp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const handlersDir = 'src/handlers';
const entries = (await readdir(handlersDir)).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

await rm('dist', { recursive: true, force: true });

await Promise.all(
  entries.map((file) => {
    const name = path.basename(file, '.ts');
    return build({
      entryPoints: [path.join(handlersDir, file)],
      outfile: `dist/${name}/index.mjs`,
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'esm',
      minify: true,
      // AWS SDK errors implement instanceof by comparing class names. Minified, every class is
      // renamed to the same short name and any SDK error matches any error class.
      keepNames: true,
      sourcemap: true,
      // The AWS SDK is bundled rather than taken from the runtime, so package-lock pins its version.
      // The banner lets bundled CJS deps call require() inside an ESM bundle.
      banner: {
        js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
      logLevel: 'info',
    });
  }),
);

console.log(`Built ${entries.length} handler(s): ${entries.join(', ')}`);

// The web handler serves the frontend build, so ship ../web/dist inside its zip.
if (entries.includes('web.ts')) {
  const webDist = '../web/dist';
  try {
    await access(path.join(webDist, 'index.html'));
  } catch {
    throw new Error('web/dist not found: run `npm run build` in web/ before building services.');
  }
  await cp(webDist, 'dist/web/static', { recursive: true });
  console.log('Copied web/dist into dist/web/static');
}
