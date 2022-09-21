import { assertEqual, assertTrue } from '../assert/assert';
import { qError, QError_immutableProps, QError_verifySerializable } from '../error/error';
import { isQrl } from '../import/qrl-class';
import { tryGetInvokeContext } from '../use/use-core';
import { isDocument, isNode, isQwikElement } from '../util/element';
import { logWarn } from '../util/log';
import { qDev } from '../util/qdev';
import { tryGetContext } from '../props/props';
import { RenderEvent } from '../util/markers';
import { isArray, isFunction, isObject, isSerializableObject } from '../util/types';
import { isPromise } from '../util/promises';
import { canSerialize } from './serializers';
import type { ContainerState, LocalSubscriptionManager, SubscriberMap } from '../render/container';
import type { Subscriber } from '../use/use-watch';

export type QObject<T extends {}> = T & { __brand__: 'QObject' };

export const QObjectRecursive = 1 << 0;
export const QObjectImmutable = 1 << 1;

/**
 * @internal
 */
export const _IMMUTABLE = Symbol('IMMUTABLE');

/**
 * Creates a proxy that notifies of any writes.
 */
export const getOrCreateProxy = <T extends object>(
  target: T,
  containerState: ContainerState,
  flags = 0
): T => {
  const proxy = containerState.$proxyMap$.get(target);
  if (proxy) {
    return proxy;
  }
  return createProxy(target, containerState, flags, undefined);
};

export const createProxy = <T extends object>(
  target: T,
  containerState: ContainerState,
  flags: number,
  subs?: Map<Element, Set<string>>
): T => {
  assertEqual(unwrapProxy(target), target, 'Unexpected proxy at this location', target);
  assertTrue(!containerState.$proxyMap$.has(target), 'Proxy was already created', target);
  assertTrue(isObject(target), 'Target must be an object');
  assertTrue(
    isSerializableObject(target) || isArray(target),
    'Target must be a serializable object'
  );

  const manager = containerState.$subsManager$.$getLocal$(target, subs);
  const proxy = new Proxy(
    target,
    new ReadWriteProxyHandler(containerState, manager, flags)
  ) as any as T;
  containerState.$proxyMap$.set(target, proxy);
  return proxy;
};

const QOjectTargetSymbol = Symbol();
const QOjectSubsSymbol = Symbol();
const QOjectFlagsSymbol = Symbol();

export type TargetType = Record<string | symbol, any>;

class ReadWriteProxyHandler implements ProxyHandler<TargetType> {
  constructor(
    private $containerState$: ContainerState,
    private $manager$: LocalSubscriptionManager,
    private $flags$: number
  ) {}

  get(target: TargetType, prop: string | symbol): any {
    if (typeof prop === 'symbol') {
      if (prop === QOjectTargetSymbol) return target;
      if (prop === QOjectFlagsSymbol) return this.$flags$;
      if (prop === QOjectSubsSymbol) return this.$manager$.$subs$;
      return target[prop];
    }
    let subscriber: Subscriber | undefined | null;
    const invokeCtx = tryGetInvokeContext();
    const recursive = (this.$flags$ & QObjectRecursive) !== 0;
    const immutable = (this.$flags$ & QObjectImmutable) !== 0;
    const value = target[prop];
    if (invokeCtx) {
      subscriber = invokeCtx.$subscriber$;
    }
    if (immutable) {
      // If property is not declared in the target
      // or the prop is immutable, then we dont need to subscribe
      if (!(prop in target) || target[_IMMUTABLE]?.includes(prop)) {
        subscriber = null;
      }
    }
    if (subscriber) {
      const isA = isArray(target);
      this.$manager$.$addSub$(subscriber, isA ? undefined : prop);
    }
    return recursive ? wrap(value, this.$containerState$) : value;
  }

  set(target: TargetType, prop: string | symbol, newValue: any): boolean {
    if (typeof prop === 'symbol') {
      target[prop] = newValue;
      return true;
    }
    const immutable = (this.$flags$ & QObjectImmutable) !== 0;
    if (immutable) {
      throw qError(QError_immutableProps);
    }
    const recursive = (this.$flags$ & QObjectRecursive) !== 0;
    const unwrappedNewValue = recursive ? unwrapProxy(newValue) : newValue;
    if (qDev) {
      verifySerializable(unwrappedNewValue);
      const invokeCtx = tryGetInvokeContext();
      if (invokeCtx && invokeCtx.$event$ === RenderEvent) {
        logWarn(
          'State mutation inside render function. Move mutation to useWatch(), useClientEffect() or useServerMount()',
          invokeCtx.$hostElement$,
          prop
        );
      }
    }
    const isA = isArray(target);
    if (isA) {
      target[prop as any] = unwrappedNewValue;
      this.$manager$.$notifySubs$();
      return true;
    }

    const oldValue = target[prop];
    if (oldValue !== unwrappedNewValue) {
      target[prop] = unwrappedNewValue;
      this.$manager$.$notifySubs$(prop);
    }
    return true;
  }

  has(target: TargetType, property: string | symbol) {
    if (property === QOjectTargetSymbol) return true;
    if (property === QOjectFlagsSymbol) return true;

    return Object.prototype.hasOwnProperty.call(target, property);
  }

  ownKeys(target: TargetType): ArrayLike<string | symbol> {
    let subscriber: Subscriber | null | undefined = null;
    const invokeCtx = tryGetInvokeContext();
    if (invokeCtx) {
      subscriber = invokeCtx.$subscriber$;
    }
    if (subscriber) {
      this.$manager$.$addSub$(subscriber);
    }
    return Object.getOwnPropertyNames(target);
  }
}

const wrap = <T>(value: T, containerState: ContainerState): T => {
  if (isQrl(value)) {
    return value;
  }
  if (isObject(value)) {
    if (Object.isFrozen(value)) {
      return value;
    }
    const nakedValue = unwrapProxy(value);
    if (nakedValue !== value) {
      // already a proxy return;
      return value;
    }
    if (isNode(nakedValue)) {
      return value;
    }
    if (!shouldSerialize(nakedValue)) {
      return value;
    }
    if (qDev) {
      verifySerializable<T>(value);
    }
    const proxy = containerState.$proxyMap$.get(value);
    return proxy ? proxy : getOrCreateProxy(value as any, containerState, QObjectRecursive);
  } else {
    return value;
  }
};

export const verifySerializable = <T>(value: T): T => {
  const seen = new Set();
  return _verifySerializable(value, seen);
};

const _verifySerializable = <T>(value: T, seen: Set<any>): T => {
  const unwrapped = unwrapProxy(value);
  if (unwrapped == null) {
    return value;
  }
  if (shouldSerialize(unwrapped)) {
    if (seen.has(unwrapped)) {
      return value;
    }
    seen.add(unwrapped);
    if (canSerialize(unwrapped)) {
      return value;
    }
    switch (typeof unwrapped) {
      case 'object':
        if (isPromise(unwrapped)) return value;
        if (isQwikElement(unwrapped)) return value;
        if (isDocument(unwrapped)) return value;
        if (isArray(unwrapped)) {
          for (const item of unwrapped) {
            _verifySerializable(item, seen);
          }
          return value;
        }
        if (isSerializableObject(unwrapped)) {
          for (const item of Object.values(unwrapped)) {
            _verifySerializable(item, seen);
          }
          return value;
        }
        break;
      case 'boolean':
      case 'string':
      case 'number':
        return value;
    }
    throw qError(QError_verifySerializable, unwrapped);
  }
  return value;
};
const noSerializeSet = /*#__PURE__*/ new WeakSet<any>();

export const shouldSerialize = (obj: any): boolean => {
  if (isObject(obj) || isFunction(obj)) {
    return !noSerializeSet.has(obj);
  }
  return true;
};

export const fastShouldSerialize = (obj: any): boolean => {
  return !noSerializeSet.has(obj);
};

/**
 * Returned type of the `noSerialize()` function. It will be TYPE or undefined.
 *
 * @see noSerialize
 * @public
 */
export type NoSerialize<T> = (T & { __no_serialize__: true }) | undefined;

// <docs markdown="../readme.md#noSerialize">
// !!DO NOT EDIT THIS COMMENT DIRECTLY!!!
// (edit ../readme.md#noSerialize instead)
/**
 * Marks a property on a store as non-serializable.
 *
 * At times it is necessary to store values on a store that are non-serializable. Normally this
 * is a runtime error as Store wants to eagerly report when a non-serializable property is
 * assigned to it.
 *
 * You can use `noSerialize()` to mark a value as non-serializable. The value is persisted in the
 * Store but does not survive serialization. The implication is that when your application is
 * resumed, the value of this object will be `undefined`. You will be responsible for recovering
 * from this.
 *
 * See: [noSerialize Tutorial](http://qwik.builder.io/tutorial/store/no-serialize)
 *
 * @public
 */
// </docs>
export const noSerialize = <T extends object | undefined>(input: T): NoSerialize<T> => {
  if (input != null) {
    noSerializeSet.add(input);
  }
  return input as any;
};

/**
 * @alpha
 * @deprecated Remove it, not needed anymore
 */
export const mutable = <T>(v: T): T => {
  console.warn(
    'mutable() is deprecated, you can safely remove all usages of mutable() in your code'
  );
  return v;
};

export const isConnected = (sub: Subscriber): boolean => {
  if (isQwikElement(sub)) {
    return !!tryGetContext(sub) || sub.isConnected;
  } else {
    return isConnected(sub.$el$);
  }
};

/**
 * @alpha
 */
export const unwrapProxy = <T>(proxy: T): T => {
  return isObject(proxy) ? getProxyTarget<any>(proxy) ?? proxy : proxy;
};

export const getProxyTarget = <T extends Record<string, any>>(obj: T): T | undefined => {
  return (obj as any)[QOjectTargetSymbol];
};

export const getProxySubs = (obj: any): SubscriberMap | undefined => {
  return (obj as any)[QOjectSubsSymbol];
};

export const getProxyFlags = <T = Record<string, any>>(obj: T): number | undefined => {
  if (isObject(obj)) {
    return (obj as any)[QOjectFlagsSymbol];
  }
  return undefined;
};
