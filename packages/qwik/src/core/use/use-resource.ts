import { $, QRL } from '../qrl/qrl.public';
import { assertQrl } from '../qrl/qrl-class';
import {
  ResourceReturn,
  ResourceDescriptor,
  ResourceFn,
  runResource,
  WatchFlagsIsDirty,
  WatchFlagsIsResource,
  Task,
  ResourceReturnInternal,
} from './use-task';
import { Fragment, jsx } from '../render/jsx/jsx-runtime';
import type { JSXNode } from '../render/jsx/types/jsx-node';
import { isServer } from '../platform/platform';
import { untrack, useBindInvokeContext } from './use-core';

import type { ContainerState, GetObjID } from '../container/container';
import { useSequentialScope } from './use-sequential-scope';
import { createProxy } from '../state/store';
import { getProxyTarget } from '../state/common';
import { isSignal, Signal } from '../state/signal';
import { isObject } from '../util/types';

/**
 * Options to pass to `useResource$()`
 *
 * @see useResource
 * @public
 */
export interface ResourceOptions {
  /**
   * Timeout in milliseconds. If the resource takes more than the specified millisecond, it will timeout.
   * Resulting on a rejected resource.
   */
  timeout?: number;
}

// <docs markdown="../readme.md#useResource">
// !!DO NOT EDIT THIS COMMENT DIRECTLY!!!
// (edit ../readme.md#useResource instead)
/**
 * This method works like an async memoized function that runs whenever some tracked value
 * changes and returns some data.
 *
 * `useResouce` however returns immediate a `ResourceReturn` object that contains the data and a
 * state that indicates if the data is available or not.
 *
 * The status can be one of the following:
 *
 * - 'pending' - the data is not yet available.
 * - 'resolved' - the data is available.
 * - 'rejected' - the data is not available due to an error or timeout.
 *
 * ### Example
 *
 * Example showing how `useResource` to perform a fetch to request the weather, whenever the
 * input city name changes.
 *
 * ```tsx
 * const Cmp = component$(() => {
 *   const store = useStore({
 *     city: '',
 *   });
 *
 *   const weatherResource = useResource$<any>(async ({ track, cleanup }) => {
 *     const cityName = track(() => store.city);
 *     const abortController = new AbortController();
 *     cleanup(() => abortController.abort('cleanup'));
 *     const res = await fetch(`http://weatherdata.com?city=${cityName}`, {
 *       signal: abortController.signal,
 *     });
 *     const data = res.json();
 *     return data;
 *   });
 *
 *   return (
 *     <div>
 *       <input name="city" onInput$={(ev: any) => (store.city = ev.target.value)} />
 *       <Resource
 *         value={weatherResource}
 *         onResolved={(weather) => {
 *           return <div>Temperature: {weather.temp}</div>;
 *         }}
 *       />
 *     </div>
 *   );
 * });
 * ```
 *
 * @see Resource
 * @see ResourceReturn
 *
 * @public
 */
// </docs>
export const useResourceQrl = <T>(
  qrl: QRL<ResourceFn<T>>,
  opts?: ResourceOptions
): ResourceReturn<T> => {
  const { get, set, i, iCtx, elCtx } = useSequentialScope<ResourceReturn<T>>();
  if (get != null) {
    return get;
  }
  assertQrl(qrl);

  const containerState = iCtx.$renderCtx$.$static$.$containerState$;
  const resource = createResourceReturn<T>(containerState, opts);
  const el = elCtx.$element$;
  const watch = new Task(
    WatchFlagsIsDirty | WatchFlagsIsResource,
    i,
    el,
    qrl,
    resource
  ) as ResourceDescriptor<any>;
  const previousWait = Promise.all(iCtx.$waitOn$.slice());
  runResource(watch, containerState, iCtx.$renderCtx$, previousWait);
  if (!elCtx.$watches$) {
    elCtx.$watches$ = [];
  }
  elCtx.$watches$.push(watch);
  set(resource);

  return resource;
};

// <docs markdown="../readme.md#useResource">
// !!DO NOT EDIT THIS COMMENT DIRECTLY!!!
// (edit ../readme.md#useResource instead)
/**
 * This method works like an async memoized function that runs whenever some tracked value
 * changes and returns some data.
 *
 * `useResouce` however returns immediate a `ResourceReturn` object that contains the data and a
 * state that indicates if the data is available or not.
 *
 * The status can be one of the following:
 *
 * - 'pending' - the data is not yet available.
 * - 'resolved' - the data is available.
 * - 'rejected' - the data is not available due to an error or timeout.
 *
 * ### Example
 *
 * Example showing how `useResource` to perform a fetch to request the weather, whenever the
 * input city name changes.
 *
 * ```tsx
 * const Cmp = component$(() => {
 *   const store = useStore({
 *     city: '',
 *   });
 *
 *   const weatherResource = useResource$<any>(async ({ track, cleanup }) => {
 *     const cityName = track(() => store.city);
 *     const abortController = new AbortController();
 *     cleanup(() => abortController.abort('cleanup'));
 *     const res = await fetch(`http://weatherdata.com?city=${cityName}`, {
 *       signal: abortController.signal,
 *     });
 *     const data = res.json();
 *     return data;
 *   });
 *
 *   return (
 *     <div>
 *       <input name="city" onInput$={(ev: any) => (store.city = ev.target.value)} />
 *       <Resource
 *         value={weatherResource}
 *         onResolved={(weather) => {
 *           return <div>Temperature: {weather.temp}</div>;
 *         }}
 *       />
 *     </div>
 *   );
 * });
 * ```
 *
 * @see Resource
 * @see ResourceReturn
 *
 * @public
 */
// </docs>
export const useResource$ = <T>(
  generatorFn: ResourceFn<T>,
  opts?: ResourceOptions
): ResourceReturn<T> => {
  return useResourceQrl<T>($(generatorFn), opts);
};

/**
 * @public
 */
export interface ResourceProps<T> {
  readonly value: ResourceReturn<T> | Signal<Promise<T> | T> | Promise<T>;
  onResolved: (value: T) => JSXNode;
  onPending?: () => JSXNode;
  onRejected?: (reason: any) => JSXNode;
}

// <docs markdown="../readme.md#useResource">
// !!DO NOT EDIT THIS COMMENT DIRECTLY!!!
// (edit ../readme.md#useResource instead)
/**
 * This method works like an async memoized function that runs whenever some tracked value
 * changes and returns some data.
 *
 * `useResouce` however returns immediate a `ResourceReturn` object that contains the data and a
 * state that indicates if the data is available or not.
 *
 * The status can be one of the following:
 *
 * - 'pending' - the data is not yet available.
 * - 'resolved' - the data is available.
 * - 'rejected' - the data is not available due to an error or timeout.
 *
 * ### Example
 *
 * Example showing how `useResource` to perform a fetch to request the weather, whenever the
 * input city name changes.
 *
 * ```tsx
 * const Cmp = component$(() => {
 *   const store = useStore({
 *     city: '',
 *   });
 *
 *   const weatherResource = useResource$<any>(async ({ track, cleanup }) => {
 *     const cityName = track(() => store.city);
 *     const abortController = new AbortController();
 *     cleanup(() => abortController.abort('cleanup'));
 *     const res = await fetch(`http://weatherdata.com?city=${cityName}`, {
 *       signal: abortController.signal,
 *     });
 *     const data = res.json();
 *     return data;
 *   });
 *
 *   return (
 *     <div>
 *       <input name="city" onInput$={(ev: any) => (store.city = ev.target.value)} />
 *       <Resource
 *         value={weatherResource}
 *         onResolved={(weather) => {
 *           return <div>Temperature: {weather.temp}</div>;
 *         }}
 *       />
 *     </div>
 *   );
 * });
 * ```
 *
 * @see Resource
 * @see ResourceReturn
 *
 * @public
 */
// </docs>
export const Resource = <T>(props: ResourceProps<T>): JSXNode => {
  const isBrowser = !isServer();
  const resource = props.value as ResourceReturnInternal<T> | Promise<T> | Signal<T>;
  let promise: Promise<T> | undefined;
  if (isResourceReturn(resource)) {
    if (isBrowser) {
      if (props.onRejected) {
        resource.value.catch(() => {});
        if (resource._state === 'rejected') {
          return props.onRejected(resource._error);
        }
      }
      if (props.onPending) {
        const state = resource._state;
        if (state === 'resolved') {
          return props.onResolved(resource._resolved!);
        } else if (state === 'pending') {
          return props.onPending();
        } else if (state === 'rejected') {
          throw resource._error;
        }
      }
      if (untrack(() => resource._resolved) !== undefined) {
        return props.onResolved(resource._resolved!);
      }
    }
    promise = resource.value;
  } else if (resource instanceof Promise) {
    promise = resource;
  } else if (isSignal(resource)) {
    promise = Promise.resolve(resource.value);
  } else {
    return props.onResolved(resource as T);
  }

  // Resource path
  return jsx(Fragment, {
    children: promise.then(
      useBindInvokeContext(props.onResolved),
      useBindInvokeContext(props.onRejected)
    ),
  });
};

export const _createResourceReturn = <T>(opts?: ResourceOptions): ResourceReturnInternal<T> => {
  const resource: ResourceReturnInternal<T> = {
    __brand: 'resource',
    value: undefined as never,
    loading: isServer() ? false : true,
    _resolved: undefined as never,
    _error: undefined as never,
    _state: 'pending',
    _timeout: opts?.timeout ?? -1,
    _cache: 0,
  };
  return resource;
};

export const createResourceReturn = <T>(
  containerState: ContainerState,
  opts?: ResourceOptions,
  initialPromise?: Promise<T>
): ResourceReturnInternal<T> => {
  const result = _createResourceReturn<T>(opts);
  result.value = initialPromise as any;
  const resource = createProxy(result, containerState, undefined);
  return resource;
};

export const getInternalResource = <T>(resource: ResourceReturn<T>): ResourceReturnInternal<T> => {
  return getProxyTarget(resource) as any;
};

export const isResourceReturn = (obj: any): obj is ResourceReturn<any> => {
  return isObject(obj) && obj.__brand === 'resource';
};

export const serializeResource = (resource: ResourceReturnInternal<any>, getObjId: GetObjID) => {
  const state = resource._state;
  if (state === 'resolved') {
    return `0 ${getObjId(resource._resolved)}`;
  } else if (state === 'pending') {
    return `1`;
  } else {
    return `2 ${getObjId(resource._error)}`;
  }
};

export const parseResourceReturn = <T>(data: string): ResourceReturnInternal<T> => {
  const [first, id] = data.split(' ');
  const result = _createResourceReturn<T>(undefined);
  result.value = Promise.resolve() as any;
  if (first === '0') {
    result._state = 'resolved';
    result._resolved = id as any;
    result.loading = false;
  } else if (first === '1') {
    result._state = 'pending';
    result.value = new Promise(() => {});
    result.loading = true;
  } else if (first === '2') {
    result._state = 'rejected';
    result._error = id as any;
    result.loading = false;
  }
  return result;
};
