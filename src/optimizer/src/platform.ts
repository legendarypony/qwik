import { logWarn } from '../../core/util/log';
import type { OptimizerSystem, TransformModuleInput, TransformOutput } from './types';
import * as pathBrowser from '../../core/util/path';
import { QWIK_BINDING_MAP } from './qwik-binding-map';
import { versions } from './versions';

export async function getSystem() {
  const sys: OptimizerSystem = {
    dynamicImport: () => {
      throw new Error(`Qwik Optimizer sys.dynamicImport() not implemented`);
    },
    path: pathBrowser,
  };

  if (globalThis.IS_ESM) {
    sys.dynamicImport = (path: string) => import(path);
  }

  if (globalThis.IS_CJS) {
    if (isNodeJs()) {
      // using this api object as a way to ensure bundlers
      // do not try to inline or rewrite require()
      sys.dynamicImport = (path) => require(path);

      if (typeof TextEncoder === 'undefined') {
        // TextEncoder/TextDecoder needs to be on the global scope for the WASM file
        // https://nodejs.org/api/util.html#class-utiltextdecoder
        const nodeUtil: any = sys.dynamicImport('util');
        global.TextEncoder = nodeUtil.TextEncoder;
        global.TextDecoder = nodeUtil.TextDecoder;
      }
    } else if (isWebWorker() || isBrowserMain()) {
      sys.dynamicImport = async (path: string) => {
        const cjsRsp = await fetch(path);
        const cjsCode = await cjsRsp.text();
        const cjsModule: any = { exports: {} };
        const cjsRun = new Function('module', 'exports', cjsCode);
        cjsRun(cjsModule, cjsModule.exports);
        return cjsModule.exports;
      };
    }
  }

  if (isNodeJs()) {
    sys.path = await sys.dynamicImport('path');
  }

  return sys;
}

export const getPlatformInputFiles = async (sys: OptimizerSystem) => {
  if (typeof sys.getInputFiles === 'function') {
    return sys.getInputFiles;
  }

  if (isNodeJs()) {
    const fs: typeof import('fs') = await sys.dynamicImport('fs');

    return async (rootDir: string) => {
      const getChildFilePaths = async (dir: string): Promise<string[]> => {
        const dirItems = await fs.promises.readdir(dir);

        const files = await Promise.all(
          dirItems.map(async (subdir: any) => {
            const resolvedPath = sys.path.resolve(dir, subdir);
            const stats = await fs.promises.stat(resolvedPath);
            return stats.isDirectory() ? getChildFilePaths(resolvedPath) : [resolvedPath];
          })
        );
        const flatted = [];
        for (const file of files) {
          flatted.push(...file);
        }
        return flatted.filter((a) => extensions[sys.path.extname(a)]);
      };

      const filePaths = await getChildFilePaths(rootDir);

      const inputs = (
        await Promise.all(
          filePaths.map(async (filePath) => {
            const input: TransformModuleInput = {
              code: await fs.promises.readFile(filePath, 'utf8'),
              path: filePath.slice(rootDir.length + 1),
            };
            return input;
          })
        )
      ).sort((a, b) => {
        if (a.path < b.path) return -1;
        if (a.path > b.path) return 1;
        return 0;
      });

      return inputs;
    };
  }

  return null;
};

export async function loadPlatformBinding(sys: OptimizerSystem) {
  if (isNodeJs()) {
    // NodeJS
    const platform = (QWIK_BINDING_MAP as any)[process.platform];
    if (platform) {
      const triples = platform[process.arch];
      if (triples) {
        for (const triple of triples) {
          // NodeJS - Native Binding
          try {
            const platformBindingPath = sys.path.join('bindings', triple.platformArchABI);
            const mod = await sys.dynamicImport('./' + platformBindingPath);
            return mod;
          } catch (e) {
            logWarn(e);
          }
        }
      }
    }
  }

  if (globalThis.IS_CJS) {
    // CJS WASM

    if (isNodeJs()) {
      // CJS WASM NodeJS
      const cjsWasmPath = sys.path.join('bindings', 'qwik.wasm.cjs');
      const wasmPath = sys.path.join(__dirname, 'bindings', 'qwik_wasm_bg.wasm');
      const mod = await sys.dynamicImport('./' + cjsWasmPath);
      const fs: typeof import('fs') = await sys.dynamicImport('fs');

      return new Promise<Buffer>((resolve, reject) => {
        fs.readFile(wasmPath, (err, buf) => {
          if (err != null) {
            reject(err);
          } else {
            resolve(buf);
          }
        });
      })
        .then((buf) => WebAssembly.compile(buf))
        .then((wasm) => mod.default(wasm))
        .then(() => mod);
    }

    if (isWebWorker() || isBrowserMain()) {
      // CJS WASM Browser
      const cdnUrl = `https://cdn.jsdelivr.net/npm/@builder.io/qwik@${versions.qwik}/bindings/`;
      const cjsModuleUrl = new URL(`./qwik.wasm.cjs`, cdnUrl).href;
      const wasmUrl = new URL(`./qwik_wasm_bg.wasm`, cdnUrl).href;

      const rsps = await Promise.all([fetch(cjsModuleUrl), fetch(wasmUrl)]);

      for (const rsp of rsps) {
        if (!rsp.ok) {
          throw new Error(`Unable to fetch Qwik WASM binding from ${rsp.url}`);
        }
      }

      const cjsRsp = rsps[0];
      const wasmRsp = rsps[1];

      const cjsCode = await cjsRsp.text();
      const cjsModule: any = { exports: {} };
      const cjsRun = new Function('module', 'exports', cjsCode);
      cjsRun(cjsModule, cjsModule.exports);
      const mod = cjsModule.exports;

      // init
      await mod.default(wasmRsp);

      return mod;
    }
  }

  if (globalThis.IS_ESM) {
    // ESM WASM
    const mjsWasmPath = sys.path.join('bindings', 'qwik.wasm.mjs');
    const module = await sys.dynamicImport('./' + mjsWasmPath);
    await module.default();
    return module;
  }

  throw new Error(`Platform not supported`);
}

export interface PlatformBinding {
  transform_fs?: (opts: any) => TransformOutput;
  transform_modules: (opts: any) => TransformOutput;
}

export function isNodeJs() {
  return (
    typeof process !== 'undefined' &&
    process.versions &&
    process.versions.node &&
    typeof global !== 'undefined'
  );
}

export function isBrowserMain() {
  return (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    typeof location !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof Window === 'function' &&
    typeof fetch === 'function'
  );
}

export function isWebWorker() {
  return (
    typeof self !== 'undefined' &&
    typeof location !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof fetch === 'function' &&
    typeof WorkerGlobalScope === 'function' &&
    typeof (self as any).importScripts === 'function'
  );
}

const extensions: { [ext: string]: boolean } = {
  '.js': true,
  '.ts': true,
  '.tsx': true,
  '.jsx': true,
};

declare const globalThis: { IS_CJS: boolean; IS_ESM: boolean };
declare const global: { [key: string]: any };
declare const WorkerGlobalScope: any;
