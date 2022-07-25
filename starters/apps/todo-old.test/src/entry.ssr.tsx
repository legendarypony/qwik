import { renderToString, RenderOptions } from '@builder.io/qwik/server';
import { Root } from './root';

/**
 * Qwik server-side render function.
 */
export default function (opts: RenderOptions) {
  return renderToString(<Root />, opts);
}
