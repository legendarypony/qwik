import type { Plugin, WatchMode } from 'esbuild';
import { join } from 'path';
import mri from 'mri';
import {
  access as fsAccess,
  copyFile as fsCopyFile,
  existsSync,
  mkdirSync,
  readdirSync,
  readdir as fsReaddir,
  readFile as fsReadFile,
  rmdirSync,
  stat as fsStat,
  statSync,
  unlink as fsUnlink,
  unlinkSync,
  writeFile as fsWriteFile,
  mkdir as fsMkdir,
} from 'fs';
import { promisify } from 'util';
import gzipSize from 'gzip-size';
import { minify, MinifyOptions } from 'terser';
import type { Plugin as RollupPlugin } from 'rollup';

/**
 * Contains information about the build we're generating by parsing
 * CLI args, and figuring out all the absolute file paths the
 * build will be reading from and writing to.
 */
export interface BuildConfig {
  rootDir: string;
  distDir: string;
  srcNapiDir: string;
  srcDir: string;
  scriptsDir: string;
  startersDir: string;
  tscDir: string;
  distPkgDir: string;
  distBindingsDir: string;
  esmNode: boolean;
  distVersion: string;
  platformTarget?: string;
  bazelOutputDir?: string;

  api?: boolean;
  build?: boolean;
  cli?: boolean;
  commit?: boolean;
  dev?: boolean;
  dryRun?: boolean;
  jsx?: boolean;
  platformBinding?: boolean;
  prepareRelease?: boolean;
  release?: boolean;
  setDistTag?: string;
  tsc?: boolean;
  validate?: boolean;
  wasm?: boolean;
  watch?: boolean;
}

/**
 * Create the `BuildConfig` from the process args, and set the
 * absolute paths the build will be reading from and writing to.
 */
export function loadConfig(args: string[] = []) {
  const config: BuildConfig = mri(args) as any;
  config.bazelOutputDir = config.bazelOutputDir && join(process.cwd(), config.bazelOutputDir);

  config.rootDir = join(__dirname, '..');
  config.distDir = join(config.bazelOutputDir || config.rootDir, 'dist-dev');
  config.srcDir = join(config.rootDir, 'src');
  config.srcNapiDir = join(config.srcDir, 'napi');
  config.scriptsDir = join(config.rootDir, 'scripts');
  config.startersDir = join(config.rootDir, 'starters');
  config.distPkgDir = config.bazelOutputDir
    ? join(join(config.bazelOutputDir, 'package'))
    : join(config.distDir, '@builder.io-qwik');
  config.distBindingsDir = join(config.distPkgDir, 'bindings');
  config.tscDir = join(config.distDir, 'tsc-out');
  config.esmNode = parseInt(process.version.substr(1).split('.')[0], 10) >= 14;
  config.platformBinding = (config as any)['platform-binding'];
  config.prepareRelease = (config as any)['prepare-release'];
  config.platformTarget = (config as any)['platform-target'];
  config.setDistTag = (config as any)['set-dist-tag'];
  config.dryRun = (config as any)['dry-run'];

  return config;
}

export function terser(opts: MinifyOptions): RollupPlugin {
  return {
    name: 'terser',
    async generateBundle(_, bundle) {
      for (const fileName in bundle) {
        const chunk = bundle[fileName];
        if (chunk.type === 'chunk') {
          const result = await minify(chunk.code, opts);
          chunk.code = result.code!;
        }
      }
    },
  };
}

/**
 * Esbuild plugin to change an import path, but keep it an external path.
 */
export function importPath(filter: RegExp, newModulePath: string) {
  const plugin: Plugin = {
    name: 'importPathPlugin',
    setup(build) {
      build.onResolve({ filter }, () => ({
        path: newModulePath,
        external: true,
      }));
    },
  };
  return plugin;
}

/**
 * Esbuild plugin to print out console logs the rebuild has finished or if it has errors.
 */
export function watcher(config: BuildConfig, filename?: string): WatchMode | boolean {
  if (config.watch) {
    return {
      onRebuild(error) {
        if (error) console.error('watch build failed:', error);
        else {
          if (filename) console.log('rebuilt:', filename);
        }
      },
    };
  }
  return false;
}

/**
 * Standard license banner to place at the top of the generated files.
 */
export const banner = {
  js: `
/**
 * @license
 * Copyright Builder.io, Inc. All Rights Reserved.
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://github.com/BuilderIO/qwik/blob/main/LICENSE
 */
`.trim(),
};

/**
 * The JavaScript target we're going for. Reusing a constant just to make sure
 * all the builds are using the same target.
 */
export const target = 'es2018';

export const nodeTarget = 'node10';

/**
 * Helper just to know which NodeJS modules that should stay external.
 */
export const nodeBuiltIns = [
  'assert',
  'child_process',
  'crypto',
  'fs',
  'module',
  'net',
  'os',
  'path',
  'tty',
  'url',
  'util',
];

export function injectDirname(config: BuildConfig) {
  return join(config.scriptsDir, 'shim', '__dirname.js');
}

export function injectGlobalThisPoly(config: BuildConfig) {
  return join(config.scriptsDir, 'shim', 'globalthis.js');
}

export function injectGlobalPoly(config: BuildConfig) {
  return join(config.scriptsDir, 'shim', 'global.js');
}

/**
 * Utility just to ignore certain rollup warns we already know aren't issues.
 */
export function rollupOnWarn(warning: any, warn: any) {
  // skip certain warnings
  if (warning.code === `CIRCULAR_DEPENDENCY`) return;
  if (warning.code === `PREFER_NAMED_EXPORTS`) return;
  if (warning.message.includes(`Rollup 'sourcemap'`)) return;
  console.log(warning);
  warn(warning);
}

/**
 * Helper just to get and format a file's size for logging.
 */
export async function fileSize(filePath: string) {
  const text = await readFile(filePath);
  const gzipBytes = await gzipSize(text);

  const size = formatFileSize(text.length);
  const gzip = formatFileSize(gzipBytes);
  return `${size} (${gzip} gz)`;
}

function formatFileSize(bytes: number) {
  if (bytes === 0) return '0b';
  const k = 1024;
  const dm = bytes < k ? 0 : 1;
  const sizes = ['b', 'kb'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + '' + sizes[i];
}

export const access = /*@__PURE__*/ promisify(fsAccess);
export const copyFile = /*@__PURE__*/ promisify(fsCopyFile);
export const readFile = /*@__PURE__*/ promisify(fsReadFile);
export const readdir = /*@__PURE__*/ promisify(fsReaddir);
export const unlink = /*@__PURE__*/ promisify(fsUnlink);
export const stat = /*@__PURE__*/ promisify(fsStat);
export const writeFile = /*@__PURE__*/ promisify(fsWriteFile);
export const mkdir = /*@__PURE__*/ promisify(fsMkdir);

export function emptyDir(dir: string) {
  if (existsSync(dir)) {
    const items = readdirSync(dir).map((f) => join(dir, f));
    for (const item of items) {
      const s = statSync(item);
      if (s.isDirectory()) {
        emptyDir(item);
        try {
          rmdirSync(item);
        } catch (e) {}
      } else if (s.isFile()) {
        unlinkSync(item);
      }
    }
  } else {
    ensureDir(dir);
  }
}

export function ensureDir(dir: string) {
  try {
    mkdirSync(dir, { recursive: true });
  } catch (e) {}
}

export function panic(msg: string) {
  console.error(`\n❌ ${msg}\n`, new Error(msg).stack);
  process.exit(1);
}

/**
 * Interface for package.json
 */
export interface PackageJSON {
  name: string;
  version: string;
  devDependencies?: { [pkgName: string]: string };
  description?: string;
  license?: string;
  main: string;
  module: string;
  types: string;
  type?: string;
  files?: string[];
  exports?: { [key: string]: string | { [key: string]: string } };
  contributors?: { [key: string]: string }[];
  homepage?: string;
  repository?: { [key: string]: string };
  bugs?: { [key: string]: string };
  keywords?: string[];
  engines?: { [key: string]: string };
  private?: boolean;
  priority?: number;
}

export interface CliGenerateOptions {
  projectName?: string;
  appId?: string;
  serverId?: string;
}

export interface CliStarters {
  apps: CliStarterData[];
  servers: CliStarterData[];
}

export interface CliStarterData {
  id: string;
  name: string;
  description: string;
  dir: string;
  priority: number;
}
