import { join } from 'path';
import { suite as uvuSuite } from 'uvu';
import type { NormalizedPluginOptions } from '../types';
import type { PageAttributes } from '../../runtime';

export function suite(title?: string) {
  const s = uvuSuite<TestContext>(title);
  s.before.each((ctx) => {
    ctx.opts = {
      pagesDir: join(__dirname, 'pages'),
      layouts: {
        full: join(__dirname, 'src', 'layouts', 'full.tsx'),
        default: join(__dirname, 'src', 'layouts', 'default.tsx'),
      },
      extensions: ['.mdx', '.md'],
    };
    ctx.filePath = join(ctx.opts.pagesDir, 'welcome.mdx');
    ctx.attrs = { title: '', description: '' };
  });
  return s;
}

export interface TestContext {
  opts: NormalizedPluginOptions;
  filePath: string;
  attrs: PageAttributes;
}
