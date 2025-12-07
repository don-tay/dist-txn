/**
 * Custom webpack configuration using SWC for fast compilation.
 * Used by NestJS CLI when building applications.
 *
 * This file is CommonJS (.cjs) because NestJS CLI uses require() to load it,
 * but it configures webpack to OUTPUT ESM format.
 *
 * With npm workspaces, @app/common is a proper package that gets resolved
 * via node_modules symlink at runtime, so we mark it as external.
 */

module.exports = (options, webpack) => {
  // Replace ts-loader with swc-loader for faster compilation
  const rules =
    options.module?.rules?.map((rule) => {
      if (rule.loader === 'ts-loader' || rule.use === 'ts-loader') {
        return {
          test: /\.tsx?$/,
          exclude: /node_modules/,
          use: {
            loader: 'swc-loader',
            options: {
              jsc: {
                parser: {
                  syntax: 'typescript',
                  decorators: true,
                  dynamicImport: true,
                },
                transform: {
                  decoratorMetadata: true,
                  legacyDecorator: true,
                },
                target: 'es2022',
                keepClassNames: true,
              },
              module: {
                type: 'es6',
                strict: true,
              },
              sourceMaps: true,
            },
          },
        };
      }
      return rule;
    }) || [];

  return {
    ...options,
    module: {
      ...options.module,
      rules,
    },
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
    },
    externalsType: 'module',
    // All non-relative imports are external (including @app/common via workspaces)
    externals: [
      ({ request }, callback) => {
        if (request && !request.startsWith('.') && !request.startsWith('/')) {
          return callback(null, `module ${request}`);
        }
        callback();
      },
    ],
  };
};
