import type { Plugin as RollupPlugin, RollupError } from 'rollup';
import { getValidManifest } from '../manifest';
import type { Diagnostic, Optimizer, OptimizerOptions } from '../types';
import { BasePluginOptions, createPlugin, QwikBuildMode, Q_MANIFEST_FILENAME } from './plugin';

/**
 * @alpha
 */
export function qwikRollup(qwikRollupOpts: QwikRollupPluginOptions = {}): any {
  const qwikPlugin = createPlugin(qwikRollupOpts.optimizerOptions);

  const rollupPlugin: QwikRollupPlugin = {
    name: 'rollup-plugin-qwik',

    api: {
      getOptimizer: () => qwikPlugin.getOptimizer(),
    },

    async options(inputOpts) {
      inputOpts.onwarn = (warning, warn) => {
        if (warning.plugin === 'typescript' && warning.message.includes('outputToFilesystem')) {
          return;
        }
        warn(warning);
      };

      const opts = await qwikPlugin.normalizeOptions(qwikRollupOpts);

      if (opts.buildMode === 'ssr') {
        // Server input
        if (!inputOpts.input) {
          inputOpts.input = opts.srcEntryServerInput;
        }
        inputOpts.treeshake = false;
      } else {
        // Client input
        if (!inputOpts.input) {
          inputOpts.input = opts.srcRootInput;
        }
      }

      return inputOpts;
    },

    outputOptions(outputOpts) {
      const opts = qwikPlugin.getOptions();
      if (opts.buildMode === 'ssr') {
        // Server output
        if (!outputOpts.dir) {
          outputOpts.dir = opts.outServerDir;
        }
        if (!outputOpts.format) {
          outputOpts.format = 'cjs';
        }
      } else {
        // Client output
        if (!outputOpts.dir) {
          outputOpts.dir = opts.outClientDir;
        }
        if (!outputOpts.format) {
          outputOpts.format = 'es';
        }
      }
      if (outputOpts.format === 'cjs' && typeof outputOpts.exports !== 'string') {
        outputOpts.exports = 'auto';
      }
      return outputOpts;
    },

    async buildStart() {
      qwikPlugin.onAddWatchFile((path) => this.addWatchFile(path));

      qwikPlugin.onDiagnostics((diagnostics, optimizer) => {
        diagnostics.forEach((d) => {
          if (d.severity === 'Error') {
            this.error(createRollupError(optimizer, d));
          } else {
            this.warn(createRollupError(optimizer, d));
          }
        });
      });

      await qwikPlugin.buildStart();
    },

    resolveId(id, importer) {
      if (id.startsWith('\0')) {
        return null;
      }
      return qwikPlugin.resolveId(id, importer);
    },

    load(id) {
      if (id.startsWith('\0')) {
        return null;
      }
      return qwikPlugin.load(id);
    },

    transform(code, id) {
      if (id.startsWith('\0')) {
        return null;
      }
      return qwikPlugin.transform(code, id);
    },

    async generateBundle(_, rollupBundle) {
      const opts = qwikPlugin.getOptions();

      if (opts.buildMode === 'production' || opts.buildMode === 'development') {
        // client build
        const outputAnalyzer = qwikPlugin.createOutputAnalyzer();

        for (const fileName in rollupBundle) {
          const b = rollupBundle[fileName];
          if (b.type === 'chunk') {
            outputAnalyzer.addBundle({
              fileName,
              modules: b.modules,
              imports: b.imports,
              dynamicImports: b.dynamicImports,
              size: b.code.length,
            });
          }
        }

        const manifest = await outputAnalyzer.generateManifest();
        if (typeof opts.manifestOutput === 'function') {
          await opts.manifestOutput(manifest);
        }

        this.emitFile({
          type: 'asset',
          fileName: Q_MANIFEST_FILENAME,
          source: JSON.stringify(manifest, null, 2),
        });

        if (typeof opts.transformedModuleOutput === 'function') {
          await opts.transformedModuleOutput(qwikPlugin.getTransformedOutputs());
        }
      } else if (opts.buildMode === 'ssr') {
        // ssr build
        const manifestInput = getValidManifest(opts.manifestInput);
        if (manifestInput) {
          const manifestStr = JSON.stringify(opts.manifestInput);
          for (const fileName in rollupBundle) {
            const b = rollupBundle[fileName];
            if (b.type === 'chunk') {
              b.code = qwikPlugin.updateSsrManifestDefault(manifestStr, b.code);
            }
          }
        }
      }
    },
  };

  return rollupPlugin;
}

export const createRollupError = (optimizer: Optimizer, diagnostic: Diagnostic) => {
  const loc = diagnostic.code_highlights[0]?.loc ?? {};
  const id = optimizer
    ? optimizer.sys.path.join(optimizer.sys.cwd(), diagnostic.origin)
    : diagnostic.origin;
  const err: RollupError = Object.assign(new Error(diagnostic.message), {
    id,
    plugin: 'qwik',
    loc: {
      column: loc.start_col,
      line: loc.start_line,
    },
    stack: '',
  });
  return err;
};

/**
 * @alpha
 */
export interface QwikRollupPluginOptions extends BasePluginOptions {
  optimizerOptions?: OptimizerOptions;
  rootDir?: string;
  buildMode?: QwikBuildMode;
}

export interface QwikRollupPlugin extends RollupPlugin {}
