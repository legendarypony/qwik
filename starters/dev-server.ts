// DO NOT USE FOR PRODUCTION!!!
// Internal Testing/Dev Server
// DO NOT USE FOR PRODUCTION!!!
/* eslint-disable no-console */

import express, { NextFunction, Request, Response } from 'express';
import { build, InlineConfig, PluginOption } from 'vite';
import { join, resolve } from 'node:path';
import { readdirSync, statSync, unlinkSync, rmdirSync, existsSync, readFileSync } from 'node:fs';
import type { QwikManifest } from '@builder.io/qwik/optimizer';
import type { Render, RenderToStreamOptions } from '@builder.io/qwik/server';
import type { PackageJSON } from '../scripts/util';
import { fileURLToPath } from 'node:url';
import nodeFetch, { Headers, Request as R, Response as RE } from 'node-fetch';
import { getErrorHtml } from '../packages/qwik-city/middleware/request-handler/error-handler';

const app = express();
const port = parseInt(process.argv[process.argv.length - 1], 10) || 3300;
const address = `http://localhost:${port}/`;
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const startersDir = __dirname;
const startersAppsDir = join(startersDir, 'apps');
const appNames = readdirSync(startersAppsDir).filter(
  (p) => statSync(join(startersAppsDir, p)).isDirectory() && p !== 'base'
);

const packagesDir = resolve(__dirname, '..', 'packages');
const qwikDistDir = join(packagesDir, 'qwik', 'dist');
const qwikCityDistDir = join(packagesDir, 'qwik-city', 'lib');
const qwikDistOptimizerPath = join(qwikDistDir, 'optimizer.mjs');
const qwikCityDistVite = join(qwikCityDistDir, 'vite', 'index.mjs');
const qwikCityMjs = join(qwikCityDistDir, 'index.qwik.mjs');

const qwikCityVirtualEntry = '@city-ssr-entry';
const entrySsrFileName = 'entry.ssr.tsx';
const qwikCityNotFoundPaths = '@qwik-city-not-found-paths';
const qwikCityStaticPaths = '@qwik-city-static-paths';

Error.stackTraceLimit = 1000;

// dev server builds ssr's the starter app on-demand (don't do this in production)
const cache = new Map<string, Promise<QwikManifest>>();
async function handleApp(req: Request, res: Response, next: NextFunction) {
  try {
    const url = new URL(req.url, address);
    const paths = url.pathname.split('/');
    const appName = paths[1];
    const appDir = join(startersAppsDir, appName);
    if (!existsSync(appDir)) {
      res.send(`❌ Invalid dev-server path: ${appDir}`);
      return;
    }

    console.log(req.method, req.url, `[${appName} build/ssr]`);

    const pkgPath = join(appDir, 'package.json');
    const pkgJson: PackageJSON = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const enableCityServer = !!pkgJson.__qwik__?.qwikCity;

    let clientManifest = cache.get(appDir);
    if (!clientManifest) {
      clientManifest = buildApp(appDir, appName, enableCityServer);
      cache.set(appDir, clientManifest);
    }

    const resolved = await clientManifest;

    res.set('Content-Type', 'text/html');
    if (enableCityServer) {
      await cityApp(req, res, next, appDir);
    } else {
      await ssrApp(req, res, appName, appDir, resolved);
      res.end();
    }
  } catch (e: any) {
    console.error(e);
    if (!res.headersSent) {
      res.set('Content-Type', 'text/plain; charset=utf-8');
      res.send(`❌ ${e.stack || e}`);
    }
  }
}

async function buildApp(appDir: string, appName: string, enableCityServer: boolean) {
  const optimizer: typeof import('@builder.io/qwik/optimizer') = await import(
    qwikDistOptimizerPath
  );
  const appSrcDir = join(appDir, 'src');
  const appDistDir = join(appDir, 'dist');
  const appServerDir = join(appDir, 'server');
  const baseUrl = `/${appName}/`;
  const isProd = appName.includes('.prod');

  // always clean the build directory
  removeDir(appDistDir);
  removeDir(appServerDir);

  let clientManifest: QwikManifest | undefined = undefined;
  const plugins: PluginOption[] = [];
  if (enableCityServer) {
    // ssr entry existed in service folder, use dev plugin to
    // 1. export router
    // 2. set baseUrl
    plugins.push({
      name: 'devPlugin',
      resolveId(id) {
        if (id.endsWith(qwikCityVirtualEntry)) {
          return qwikCityVirtualEntry;
        }
        if (id === qwikCityStaticPaths || id === qwikCityNotFoundPaths) {
          return './' + id;
        }
      },
      load(id) {
        if (id.endsWith(qwikCityVirtualEntry)) {
          return `import { createQwikCity } from '@builder.io/qwik-city/middleware/node';
import render from '${resolve(appSrcDir, 'entry.ssr')}';
import qwikCityPlan from '@qwik-city-plan';
const { router, notFound } = createQwikCity({
  render,
  qwikCityPlan,
  base: '${baseUrl}build/',
});
export {
  router,
  notFound
}
`;
        }
        if (id.endsWith(qwikCityStaticPaths)) {
          return `export function isStaticPath(){ return false; };`;
        }
        if (id.endsWith(qwikCityNotFoundPaths)) {
          const notFoundHtml = getErrorHtml(404, 'Resource Not Found');
          return `export function getNotFound(){ return ${JSON.stringify(notFoundHtml)}; };`;
        }
      },
    });
    const qwikCityVite: typeof import('@builder.io/qwik-city/vite') = await import(
      qwikCityDistVite
    );
    plugins.push(
      qwikCityVite.qwikCity({
        basePathname: '/qwikcity-test/',
      })
    );
  }
  const getInlineConf = (extra?: InlineConfig): InlineConfig => ({
    root: appDir,
    mode: 'development',
    configFile: false,
    base: baseUrl,
    ...extra,
    resolve: {
      alias: {
        '@builder.io/qwik': qwikDistDir,
        '@builder.io/qwik-city': qwikCityDistDir,
      },
    },
  });

  await build(
    getInlineConf({
      build: {
        minify: false,
      },
      define: {
        'globalThis.qSerialize': true,
        'globalThis.qDev': !isProd,
        'globalThis.PORT': port,
      },
      plugins: [
        ...plugins,
        optimizer.qwikVite({
          vendorRoots: enableCityServer ? [qwikCityMjs] : [],
          entryStrategy: {
            type: 'single',
          },
          client: {
            // forceFullBuild: true,
            manifestOutput(manifest) {
              clientManifest = manifest;
            },
          },
        }),
      ],
    })
  );

  await build(
    getInlineConf({
      build: {
        minify: false,
        ssr: enableCityServer ? qwikCityVirtualEntry : resolve(appSrcDir, entrySsrFileName),
      },
      plugins: [...plugins, optimizer.qwikVite()],
      define: {
        'globalThis.qDev': !isProd,
        'globalThis.PORT': port,
      },
    })
  );

  return clientManifest!;
}

function removeDir(dir: string) {
  try {
    const items = readdirSync(dir);
    const itemPaths = items.map((i) => join(dir, i));
    itemPaths.forEach((itemPath) => {
      if (statSync(itemPath).isDirectory()) {
        removeDir(itemPath);
      } else {
        unlinkSync(itemPath);
      }
    });
    rmdirSync(dir);
  } catch (e) {
    /**/
  }
}

async function cityApp(req: Request, res: Response, next: NextFunction, appDir: string) {
  const ssrPath = join(appDir, 'server', `${qwikCityVirtualEntry}.js`);

  const mod = await import(ssrPath);
  const router: any = mod.router;
  router(req, res, () => {
    mod.notFound(req, res, () => {
      next();
    });
  });
}

async function ssrApp(
  req: Request,
  res: Response,
  appName: string,
  appDir: string,
  manifest: QwikManifest
) {
  const ssrPath = join(appDir, 'server', 'entry.ssr.js');
  const mod = await import(ssrPath);
  const render: Render = mod.default ?? mod.render;

  // ssr the document
  const base = `/${appName}/build/`;
  const url = new URL(`${req.protocol}://${req.hostname}${req.url}`).href;

  const opts: RenderToStreamOptions = {
    stream: res,
    manifest,
    debug: true,
    base,
    envData: {
      url,
    },
  };
  await render(opts);
}

function startersHomepage(_: Request, res: Response) {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!-- Some comment --><!DOCTYPE html>
  <html>
    <head>
      <title>Starters Dev Server</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif, Apple Color Emoji, Segoe UI Emoji;
          line-height: 1.5;
        }
        a { color: #4340C4; }
        a:hover { text-decoration: none; }
        h1 { margin: 5px 0; }
      </style>
    </head>
    <body>
      <h1>⚡️ Starters Dev Server ⚡️</h1>
      <ul>
        ${appNames.map((a) => `<li><a href="/${a}/">${a}</a></li>`).join('')}
      </ul>
    </body>
  </html>
  `);
}

(global as any).fetch = nodeFetch;
(global as any).Headers = Headers;
(global as any).Request = R;
(global as any).Response = RE;

function favicon(_: Request, res: Response) {
  const path = join(startersAppsDir, 'base', 'public', 'favicon.ico');
  res.sendFile(path);
}

const partytownPath = resolve(startersDir, '..', 'node_modules', '@builder.io', 'partytown', 'lib');
app.use(`/~partytown`, express.static(partytownPath));

appNames.forEach((appName) => {
  const buildPath = join(startersAppsDir, appName, 'dist', 'build');
  app.use(`/${appName}/build`, express.static(buildPath));

  const publicPath = join(startersAppsDir, appName, 'public');
  app.use(`/${appName}`, express.static(publicPath));
});

app.get('/', startersHomepage);
app.get('/favicon.ico', favicon);
app.all('/*', handleApp);

const server = app.listen(port, () => {
  console.log(`Starter Dir: ${startersDir}`);
  console.log(`Dev Server: ${address}\n`);

  console.log(`Starters:`);
  appNames.forEach((appName) => {
    console.log(`  ${address}${appName}/`);
  });
  console.log(``);
});

process.on('SIGTERM', () => server.close());
