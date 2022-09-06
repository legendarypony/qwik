import { jsx } from '../jsx/jsx-runtime';
import type { StreamWriter } from '../ssr/render-ssr';
import type { FunctionComponent, JSXNode } from './types/jsx-node';
import type { JSXChildren } from './types/jsx-qwik-attributes';

export const QOnce = 'qonce';

/**
 * @alpha
 */
export const SkipRender: JSXNode = Symbol('skip render') as any;

export const RenderOnce: FunctionComponent<{ children?: any }> = (props: any, key) => {
  return jsx(
    Virtual,
    {
      ...props,
      [QOnce]: '',
    },
    key
  );
};

/**
 * @alpha
 */
export const Fragment: FunctionComponent<{}> = ((props: any) => props.children) as any;

/**
 * @alpha
 */
export const SSRComment: FunctionComponent<{ data: string }> = (() => null) as any;

/**
 * @alpha
 */
export const Virtual: FunctionComponent<Record<string, any>> = ((props: any) =>
  props.children) as any;

/**
 * @alpha
 */
export const SSRStreamBlock: FunctionComponent<{ children?: any }> = (props) => {
  return [
    jsx(SSRComment, { data: 'qkssr-pu' }),
    props.children,
    jsx(SSRComment, { data: 'qkssr-po' }),
  ] as any;
};

/**
 * @alpha
 */
export interface StreamProps {
  children:
    | AsyncGenerator<JSXChildren, void, any>
    | ((stream: StreamWriter) => Promise<void>)
    | (() => AsyncGenerator<JSXChildren, void, any>);
}

/**
 * @alpha
 */
export const SSRStream: FunctionComponent<StreamProps> = (props, key) =>
  jsx(RenderOnce, { children: jsx(InternalSSRStream, props) }, key);

export const InternalSSRStream: FunctionComponent<StreamProps> = () => null;
