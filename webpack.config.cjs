/**
 * Custom webpack configuration for ESM output.
 * Used by NestJS CLI when building applications.
 *
 * This file is CommonJS (.cjs) because NestJS CLI uses require() to load it,
 * but it configures webpack to OUTPUT ESM format.
 */
const path = require('path');

module.exports = (options, webpack) => {
  return {
    ...options,
    experiments: {
      ...options.experiments,
      outputModule: true,
    },
    output: {
      ...options.output,
      module: true,
      library: {
        type: 'module',
      },
      chunkFormat: 'module',
      // Keep .js extension - package.json "type": "module" makes Node treat it as ESM
    },
    resolve: {
      ...options.resolve,
      alias: {
        ...options.resolve?.alias,
        // Ensure @app/common resolves to our internal library
        '@app/common': path.resolve(__dirname, 'libs/common/src'),
      },
    },
    externalsType: 'module',
    // Keep node_modules as external, but bundle @app/* (our internal libs)
    externals: [
      ({ request }, callback) => {
        // Bundle our internal @app/* packages
        if (request && request.startsWith('@app/')) {
          return callback();
        }
        // Keep other node_modules as external
        if (request && !request.startsWith('.') && !request.startsWith('/')) {
          return callback(null, `module ${request}`);
        }
        callback();
      },
    ],
  };
};
