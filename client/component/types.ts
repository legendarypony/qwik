/**
 * @license
 * Copyright a-Qoot All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://github.com/a-Qoot/qoot/blob/main/LICENSE
 */

import { QRL } from '../import/types.js';
import { AsyncProvider, InjectableConcreteType, Injector } from '../injection/types.js';

export interface ComponentContext<P, S> {
  host: Element;
  state: S | undefined;
  props: P;
}

export interface Component<P, S> {
  $host: Element;
  $state: S;
  $keyProps: P;
}

export interface ComponentType<T, ARGS extends any[]> extends InjectableConcreteType<T, ARGS> {
  $inject: AsyncProvider<any>[];
  new (...args: ARGS): T;
  new: <T extends Component<P, S>, P, S, ARGS extends any[]>(
    this: ComponentType<Component<P, S>, ARGS>,
    componentInjectionContext: ComponentContext<P, S>,
    ...args: ARGS
  ) => T;
  newInject: <T extends Component<P, S>, P, S, ARGS extends any[]>(
    this: ComponentType<Component<P, S>, ARGS>,
    injector: Injector
  ) => T | Promise<T>;
}

export function isComponentType(value: any): value is ComponentType<any, any> {
  return (
    typeof value === 'function' && typeof (value as ComponentType<any, any>).new === 'function'
  );
}

export interface QProps {
  [key: string]: string | QRL;
}
