import { setPlatform } from '../core/platform/platform';
import { createPlatform } from './platform';
import type { ResolvedManifest } from './prefetch-strategy';
import { resolveManifest } from './render';
import type { QwikManifest } from './types';

export type {
  PrefetchResource,
  PrefetchImplementation,
  PrefetchStrategy,
  RenderToStringOptions,
  RenderToStringResult,
  Render,
  RenderToStream,
  RenderToString,
  RenderOptions,
  RenderResult,
  RenderToStreamOptions,
  SerializeDocumentOptions,
  RenderToStreamResult,
  QwikLoaderOptions,
  StreamingOptions,
  InOrderAuto,
  InOrderDisabled,
  InOrderStreaming,
  SymbolsToPrefetch,
} from './types';
export { renderToString, renderToStream, resolveManifest } from './render';
export { versions } from './utils';
export { getQwikLoaderScript } from './scripts';

/**
 * @alpha
 */
export async function setServerPlatform(manifest: QwikManifest | ResolvedManifest | undefined) {
  const platform = createPlatform({ manifest }, resolveManifest(manifest));
  setPlatform(platform);
}
