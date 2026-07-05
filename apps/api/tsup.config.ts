import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/db/migrate.ts', 'src/db/seed.ts'],
  format: ['esm'],
  target: 'node22',
  sourcemap: true,
  clean: true,
  // Bundle the source-only workspace package into the output.
  noExternal: ['@reforger-panel/shared'],
});
