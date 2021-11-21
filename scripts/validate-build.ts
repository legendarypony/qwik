import { BuildConfig, PackageJSON, panic } from './util';
import { access, readFile } from './util';
import { extname, join } from 'path';
import { pathToFileURL } from 'url';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import ts from 'typescript';

/**
 * This will validate a completed production build by triple checking all the
 * files have been created and can execute correctly in their context. This is
 * the last task before publishing the build files to npm.
 */
export async function validateBuild(config: BuildConfig) {
  console.log('🕵️ validating build...');
  const pkgPath = join(config.distPkgDir, 'package.json');
  const pkg: PackageJSON = JSON.parse(await readFile(pkgPath, 'utf-8'));
  const errors: string[] = [];

  // triple checks these package files all exist and parse
  const pkgFiles = [...pkg.files, 'LICENSE', 'README.md', 'package.json'];
  const expectedFiles = pkgFiles.map((f) => join(config.distPkgDir, f));

  for (const filePath of expectedFiles) {
    try {
      // loop through each file and ensure it's built correct
      const ext = extname(filePath);

      switch (ext) {
        case '.cjs':
          require(filePath);
          break;
        case '.mjs':
          if (config.esmNode) {
            await import(pathToFileURL(filePath).href);
            break;
          }
        case '.ts':
          validateTypeScriptFile(config, filePath);
          break;
        case '.json':
          JSON.parse(readFileSync(filePath, 'utf-8'));
          break;
        case '.map':
          JSON.parse(readFileSync(filePath, 'utf-8'));
          break;
        default:
          if (existsSync(filePath)) {
            const content = readFileSync(filePath, 'utf-8');
            if (content.trim() === '') {
              errors.push(`Expected package.json file is empty: ${filePath}`);
            }
          } else {
            errors.push(`Expected package.json file not found: ${filePath}`);
          }
      }
    } catch (e: any) {
      errors.push(`${String(e.stack || e)}`);
    }
  }

  await validatePackageJson(config, pkg, errors);

  const allFiles: string[] = [];
  function getFiles(dir: string) {
    readdirSync(dir)
      .map((f) => join(dir, f))
      .forEach((filePath) => {
        const s = statSync(filePath);
        if (s.isDirectory()) {
          getFiles(filePath);
        } else if (s.isFile()) {
          allFiles.push(filePath);
        } else {
          errors.push(`Unexpected: ${filePath}`);
        }
      });
  }
  getFiles(config.distPkgDir);
  const unexpectedFiles = allFiles.filter((f) => !expectedFiles.includes(f));

  if (unexpectedFiles.length > 0) {
    errors.push(
      `Unexpected files found in the package build:\n${unexpectedFiles.join(
        '\n'
      )}\n\nIf this file is expected, add the file(s) to the package.json "files" array`
    );
  }

  if (errors.length > 0) {
    errors.unshift(`Build did not pass validation.`);
    panic(errors.join('\n\n❌ '));
  } else {
    console.log('🏅 validated build');
  }
}

/**
 * Do a full typescript build for each separate .d.ts file found in the package
 * just to ensure it's well formed and relative import paths are correct.
 */
export function validateTypeScriptFile(config: BuildConfig, tsFilePath: string) {
  const tsconfigPath = join(config.rootDir, 'tsconfig.json');
  const tsconfigResults = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  const tsconfig = ts.parseJsonConfigFileContent(
    tsconfigResults.config,
    ts.sys,
    config.rootDir,
    undefined,
    tsconfigPath
  );
  const program = ts.createProgram([tsFilePath], tsconfig.options);

  const tsDiagnostics = program.getSemanticDiagnostics().concat(program.getSyntacticDiagnostics());

  if (tsDiagnostics.length > 0) {
    const host = {
      getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
      getNewLine: () => ts.sys.newLine,
      getCanonicalFileName: (f: string) => f,
    };
    throw new Error(ts.formatDiagnostics(tsDiagnostics, host));
  }
}

async function validatePackageJson(config: BuildConfig, pkg: PackageJSON, errors: string[]) {
  async function validatePath(path: string) {
    try {
      await access(join(config.distPkgDir, path));
    } catch (e: any) {
      errors.push(
        `Error loading file "${path}" referenced in package.json: ${String(e.stack || e)}`
      );
    }
  }

  await Promise.all([validatePath(pkg.main), validatePath(pkg.module), validatePath(pkg.types)]);

  const exportKeys = Object.keys(pkg.exports);

  await Promise.all(
    exportKeys.map(async (exportKey) => {
      const val = pkg.exports[exportKey];
      if (typeof val === 'string') {
        await validatePath(val);
      } else {
        const exportKeys = Object.keys(val);
        for (const key of exportKeys) {
          await validatePath(val[key]);
        }
      }
    })
  );
}
