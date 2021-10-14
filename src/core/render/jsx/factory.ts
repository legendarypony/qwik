/* eslint-disable */
/**
 * @license
 * Copyright Builder.io, Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://github.com/BuilderIO/qwik/blob/main/LICENSE
 */

import { flattenArray } from '../../util/array';
import { EMPTY_ARRAY } from '../../util/flyweight';
import { JSXNodeImpl } from './jsx-runtime';
import type { QwikJSX } from './types/jsx-qwik';
import type { FunctionComponent, JSXNode } from './types/jsx-node';

/**
 * @public
 */
export function h<PROPS extends {} = {}>(
  type: string | FunctionComponent<PROPS>,
  props: PROPS | null,
  ...children: any[]
): JSXNode {
  // Using legacy h() jsx transform and morphing it
  // so it can use the modern vdom structure
  // https://reactjs.org/blog/2020/09/22/introducing-the-new-jsx-transform.html
  // https://www.typescriptlang.org/tsconfig#jsxImportSource

  const normalizedProps: any = {
    children: arguments.length > 2 ? flattenArray(children) : EMPTY_ARRAY,
  };

  let key: any;
  let i: any;

  for (i in props) {
    if (i == 'key') key = (props as Record<string, any>)[i];
    else normalizedProps[i] = (props as Record<string, any>)[i];
  }

  return new JSXNodeImpl(type, normalizedProps, key);
}

/**
 * @public
 */
export declare namespace h {
  export function h(type: any): JSXNode<any>;
  export function h(type: Node, data: any): JSXNode<any>;
  export function h(type: any, text: string): JSXNode<any>;
  export function h(type: any, children: Array<any>): JSXNode<any>;
  export function h(type: any, data: any, text: string): JSXNode<any>;
  export function h(
    type: any,
    data: any,
    children: Array<JSXNode<any> | undefined | null>
  ): JSXNode<any>;
  export function h(sel: any, data: any | null, children: JSXNode<any>): JSXNode<any>;

  export namespace JSX {
    export interface Element extends QwikJSX.Element {}
    export interface IntrinsicAttributes extends QwikJSX.IntrinsicAttributes {}
    export interface IntrinsicElements extends QwikJSX.IntrinsicElements {}
    // TODO(misko): Commenting this out does not seem to make a difference.
    export interface ElementChildrenAttribute {
      children?: any;
    }
  }
}
