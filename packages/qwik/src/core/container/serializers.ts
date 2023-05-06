import { type Component, componentQrl, isQwikComponent } from '../component/component.public';
import { parseQRL, serializeQRL } from '../qrl/qrl';
import { isQrl, type QRLInternal } from '../qrl/qrl-class';
import type { QRL } from '../qrl/qrl.public';
import { intToStr, type ContainerState, type GetObject, type MustGetObjID } from './container';
import { isResourceReturn, parseResourceReturn, serializeResource } from '../use/use-resource';
import {
  isSubscriberDescriptor,
  parseTask,
  type ResourceReturnInternal,
  serializeWatch,
  type SubscriberEffect,
} from '../use/use-task';
import { isDocument } from '../util/element';
import {
  QObjectSignalFlags,
  SIGNAL_IMMUTABLE,
  SignalDerived,
  SignalImpl,
  SignalWrapper,
} from '../state/signal';
import { type Collector, collectSubscriptions, collectValue } from './pause';
import {
  fastWeakSerialize,
  getProxyManager,
  LocalSubscriptionManager,
  type SubscriptionManager,
  type Subscriptions,
} from '../state/common';
import { getOrCreateProxy } from '../state/store';
import { QObjectManagerSymbol } from '../state/constants';
import { serializeDerivedSignalFunc } from '../qrl/inlined-fn';
import type { QwikElement } from '../render/dom/virtual-element';
import { assertString } from '../error/assert';
import { Fragment, JSXNodeImpl, isJSXNode } from '../render/jsx/jsx-runtime';
import type { JSXNode } from '@builder.io/qwik/jsx-runtime';
import { Slot } from '../render/jsx/slot.public';

/**
 * 0, 8, 9, A, B, C, D
\0: null character (U+0000 NULL) (only if the next character is not a decimal digit; else it’s an octal escape sequence)
\b: backspace (U+0008 BACKSPACE)
\t: horizontal tab (U+0009 CHARACTER TABULATION)
\n: line feed (U+000A LINE FEED)
\v: vertical tab (U+000B LINE TABULATION)
\f: form feed (U+000C FORM FEED)
\r: carriage return (U+000D CARRIAGE RETURN)
\": double quote (U+0022 QUOTATION MARK)
\': single quote (U+0027 APOSTROPHE)
\\: backslash (U+005C REVERSE SOLIDUS)
 */
export const UNDEFINED_PREFIX = '\u0001';

export interface Serializer<T> {
  $prefix$: string;
  /**
   * Return true if this serializer can serialize the given object.
   */
  $test$: (obj: any) => boolean;
  /**
   * Convert the object to a string.
   */
  $serialize$:
    | ((
        obj: T,
        getObjID: MustGetObjID,
        collector: Collector,
        containerState: ContainerState
      ) => string)
    | undefined;

  /**
   * Return of
   */
  $collect$?: (obj: T, collector: Collector, leaks: boolean | QwikElement) => void;

  /**
   * Deserialize the object.
   */
  $prepare$: (data: string, containerState: ContainerState, doc: Document) => T;
  /**
   * Second pass to fill in the object.
   */
  $subs$?: (obj: T, subs: Subscriptions[], containerState: ContainerState) => void;

  /**
   * Second pass to fill in the object.
   */
  $fill$: ((obj: T, getObject: GetObject, containerState: ContainerState) => void) | undefined;
}

const QRLSerializer: Serializer<QRLInternal> = {
  $prefix$: '\u0002',
  $test$: (v) => isQrl(v),
  $collect$: (v, collector, leaks) => {
    if (v.$captureRef$) {
      for (const item of v.$captureRef$) {
        collectValue(item, collector, leaks);
      }
    }
    if (collector.$prefetch$ === 0) {
      collector.$qrls$.push(v);
    }
  },
  $serialize$: (obj, getObjId) => {
    return serializeQRL(obj, {
      $getObjId$: getObjId,
    });
  },
  $prepare$: (data, containerState) => {
    return parseQRL(data, containerState.$containerEl$);
  },
  $fill$: (qrl, getObject) => {
    if (qrl.$capture$ && qrl.$capture$.length > 0) {
      qrl.$captureRef$ = qrl.$capture$.map(getObject);
      qrl.$capture$ = null;
    }
  },
};

const TaskSerializer: Serializer<SubscriberEffect> = {
  $prefix$: '\u0003',
  $test$: (v) => isSubscriberDescriptor(v),
  $collect$: (v, collector, leaks) => {
    collectValue(v.$qrl$, collector, leaks);
    if (v.$state$) {
      collectValue(v.$state$, collector, leaks);
      if (leaks === true && v.$state$ instanceof SignalImpl) {
        collectSubscriptions(v.$state$[QObjectManagerSymbol], collector, true);
      }
    }
  },
  $serialize$: (obj, getObjId) => serializeWatch(obj, getObjId),
  $prepare$: (data) => parseTask(data) as any,
  $fill$: (watch, getObject) => {
    watch.$el$ = getObject(watch.$el$ as any);
    watch.$qrl$ = getObject(watch.$qrl$ as any);
    if (watch.$state$) {
      watch.$state$ = getObject(watch.$state$ as any);
    }
  },
};

const ResourceSerializer: Serializer<ResourceReturnInternal<any>> = {
  $prefix$: '\u0004',
  $test$: (v) => isResourceReturn(v),
  $collect$: (obj, collector, leaks) => {
    collectValue(obj.value, collector, leaks);
    collectValue(obj._resolved, collector, leaks);
  },
  $serialize$: (obj, getObjId) => {
    return serializeResource(obj, getObjId);
  },
  $prepare$: (data) => {
    return parseResourceReturn(data);
  },
  $fill$: (resource, getObject) => {
    if (resource._state === 'resolved') {
      resource._resolved = getObject(resource._resolved);
      resource.value = Promise.resolve(resource._resolved);
    } else if (resource._state === 'rejected') {
      const p = Promise.reject(resource._error);
      p.catch(() => null);
      resource._error = getObject(resource._error);
      resource.value = p;
    }
  },
};

const URLSerializer: Serializer<URL> = {
  $prefix$: '\u0005',
  $test$: (v) => v instanceof URL,
  $serialize$: (obj) => obj.href,
  $prepare$: (data) => new URL(data),
  $fill$: undefined,
};

const DateSerializer: Serializer<Date> = {
  $prefix$: '\u0006',
  $test$: (v) => v instanceof Date,
  $serialize$: (obj) => obj.toISOString(),
  $prepare$: (data) => new Date(data),
  $fill$: undefined,
};

const RegexSerializer: Serializer<RegExp> = {
  $prefix$: '\u0007',
  $test$: (v) => v instanceof RegExp,
  $serialize$: (obj) => `${obj.flags} ${obj.source}`,
  $prepare$: (data) => {
    const space = data.indexOf(' ');
    const source = data.slice(space + 1);
    const flags = data.slice(0, space);
    return new RegExp(source, flags);
  },
  $fill$: undefined,
};

const ErrorSerializer: Serializer<Error> = {
  $prefix$: '\u000E',
  $test$: (v) => v instanceof Error,
  $serialize$: (obj) => {
    return obj.message;
  },
  $prepare$: (text) => {
    const err = new Error(text);
    err.stack = undefined;
    return err;
  },
  $fill$: undefined,
};

const DocumentSerializer: Serializer<Document> = {
  $prefix$: '\u000F',
  $test$: (v) => isDocument(v),
  $serialize$: undefined,
  $prepare$: (_, _c, doc) => {
    return doc;
  },
  $fill$: undefined,
};

export const SERIALIZABLE_STATE = Symbol('serializable-data');
const ComponentSerializer: Serializer<Component<any>> = {
  $prefix$: '\u0010',
  $test$: (obj) => isQwikComponent(obj),
  $serialize$: (obj, getObjId) => {
    const [qrl]: [QRLInternal] = (obj as any)[SERIALIZABLE_STATE];
    return serializeQRL(qrl, {
      $getObjId$: getObjId,
    });
  },
  $prepare$: (data, containerState) => {
    const qrl: QRL<any> = parseQRL(data, containerState.$containerEl$);
    return componentQrl(qrl);
  },
  $fill$: (component, getObject) => {
    const [qrl]: [QRLInternal] = (component as any)[SERIALIZABLE_STATE];
    if (qrl.$capture$ && qrl.$capture$.length > 0) {
      qrl.$captureRef$ = qrl.$capture$.map(getObject);
      qrl.$capture$ = null;
    }
  },
};

const DerivedSignalSerializer: Serializer<SignalDerived<any, any>> = {
  $prefix$: '\u0011',
  $test$: (obj) => obj instanceof SignalDerived,
  $collect$: (obj, collector, leaks) => {
    if (obj.$args$) {
      for (const arg of obj.$args$) {
        collectValue(arg, collector, leaks);
      }
    }
  },
  $serialize$: (signal, getObjID, collector) => {
    const serialized = serializeDerivedSignalFunc(signal);
    let index = collector.$inlinedFunctions$.indexOf(serialized);
    if (index < 0) {
      collector.$inlinedFunctions$.push(serialized);
      index = collector.$inlinedFunctions$.length - 1;
    }
    const parts = signal.$args$.map(getObjID);
    return parts.join(' ') + ' @' + intToStr(index);
  },
  $prepare$: (data) => {
    const ids = data.split(' ');
    const args = ids.slice(0, -1);
    const fn = ids[ids.length - 1];
    return new SignalDerived(fn as any, args, fn);
  },
  $fill$: (fn, getObject) => {
    assertString(fn.$func$, 'fn.$func$ should be a string');
    fn.$func$ = getObject(fn.$func$);
    fn.$args$ = fn.$args$.map(getObject);
  },
};

const SignalSerializer: Serializer<SignalImpl<any>> = {
  $prefix$: '\u0012',
  $test$: (v) => v instanceof SignalImpl,
  $collect$: (obj, collector, leaks) => {
    collectValue(obj.untrackedValue, collector, leaks);
    const mutable = (obj[QObjectSignalFlags] & SIGNAL_IMMUTABLE) === 0;
    if (leaks === true && mutable) {
      collectSubscriptions(obj[QObjectManagerSymbol], collector, true);
    }
    return obj;
  },
  $serialize$: (obj, getObjId) => {
    return getObjId(obj.untrackedValue);
  },
  $prepare$: (data, containerState) => {
    return new SignalImpl(data, containerState?.$subsManager$?.$createManager$(), 0);
  },
  $subs$: (signal, subs) => {
    signal[QObjectManagerSymbol].$addSubs$(subs);
  },
  $fill$: (signal, getObject) => {
    signal.untrackedValue = getObject(signal.untrackedValue);
  },
};

const SignalWrapperSerializer: Serializer<SignalWrapper<any, any>> = {
  $prefix$: '\u0013',
  $test$: (v) => v instanceof SignalWrapper,
  $collect$(obj, collector, leaks) {
    collectValue(obj.ref, collector, leaks);
    if (fastWeakSerialize(obj.ref)) {
      const localManager = getProxyManager(obj.ref)!;
      if (isTreeShakeable(collector.$containerState$.$subsManager$, localManager, leaks)) {
        collectValue(obj.ref[obj.prop], collector, leaks);
      }
    }
    return obj;
  },
  $serialize$: (obj, getObjId) => {
    return `${getObjId(obj.ref)} ${obj.prop}`;
  },
  $prepare$: (data) => {
    const [id, prop] = data.split(' ');
    return new SignalWrapper(id as any, prop);
  },
  $fill$: (signal, getObject) => {
    signal.ref = getObject(signal.ref);
  },
};

const NoFiniteNumberSerializer: Serializer<number> = {
  $prefix$: '\u0014',
  $test$: (v) => typeof v === 'number',
  $serialize$: (v) => {
    return String(v);
  },
  $prepare$: (data) => {
    return Number(data);
  },
  $fill$: undefined,
};

const URLSearchParamsSerializer: Serializer<URLSearchParams> = {
  $prefix$: '\u0015',
  $test$: (v) => v instanceof URLSearchParams,
  $serialize$: (obj) => obj.toString(),
  $prepare$: (data) => new URLSearchParams(data),
  $fill$: undefined,
};

const FormDataSerializer: Serializer<FormData> = {
  $prefix$: '\u0016',
  $test$: (v) => typeof FormData !== 'undefined' && v instanceof globalThis.FormData,
  $serialize$: (formData) => {
    const array: [string, string][] = [];
    formData.forEach((value, key) => {
      if (typeof value === 'string') {
        array.push([key, value]);
      } else {
        array.push([key, value.name]);
      }
    });
    return JSON.stringify(array);
  },
  $prepare$: (data) => {
    const array = JSON.parse(data);
    const formData = new FormData();
    for (const [key, value] of array) {
      formData.append(key, value);
    }
    return formData;
  },
  $fill$: undefined,
};

const JSXNodeSerializer: Serializer<JSXNode> = {
  $prefix$: '\u0017',
  $test$: (v) => isJSXNode(v),
  $collect$: (node, collector, leaks) => {
    collectValue(node.children, collector, leaks);
    collectValue(node.props, collector, leaks);
    collectValue(node.immutableProps, collector, leaks);
    let type = node.type;
    if (type === Slot) {
      type = ':slot';
    } else if (type === Fragment) {
      type = ':fragment';
    }
    collectValue(type, collector, leaks);
  },
  $serialize$: (node, getObjID) => {
    let type = node.type;
    if (type === Slot) {
      type = ':slot';
    } else if (type === Fragment) {
      type = ':fragment';
    }
    return `${getObjID(type)} ${getObjID(node.props)} ${getObjID(node.immutableProps)} ${getObjID(
      node.children
    )} ${node.flags}`;
  },
  $prepare$: (data) => {
    const [type, props, immutableProps, children, flags] = data.split(' ');
    const node = new JSXNodeImpl(
      type as string,
      props as any,
      immutableProps as any,
      children,
      parseInt(flags, 10)
    );
    return node;
  },
  $fill$: (node, getObject) => {
    node.type = getResolveJSXType(getObject(node.type as string));
    node.props = getObject(node.props as any as string);
    node.immutableProps = getObject(node.immutableProps as any as string);
    node.children = getObject(node.children);
  },
};

const BigIntSerializer: Serializer<bigint> = {
  $prefix$: '\u0018',
  $test$: (v) => typeof v === 'bigint',
  $serialize$: (v) => {
    return v.toString();
  },
  $prepare$: (data) => {
    return BigInt(data);
  },
  $fill$: undefined,
};

const serializers: Serializer<any>[] = [
  QRLSerializer, ////////////// \u0002
  SignalSerializer, /////////// \u0012
  SignalWrapperSerializer, //// \u0013
  TaskSerializer, //////////// \u0003
  ResourceSerializer, ///////// \u0004
  URLSerializer, ////////////// \u0005
  DateSerializer, ///////////// \u0006
  RegexSerializer, //////////// \u0007
  ErrorSerializer, //////////// \u000E
  DocumentSerializer, ///////// \u000F
  ComponentSerializer, //////// \u0010
  DerivedSignalSerializer, //// \u0011
  NoFiniteNumberSerializer, /// \u0014
  URLSearchParamsSerializer, // \u0015
  FormDataSerializer, ///////// \u0016
  JSXNodeSerializer, ////////// \u0017
  BigIntSerializer, /////////// \u0018
];

const collectorSerializers = /*#__PURE__*/ serializers.filter((a) => a.$collect$);

export const canSerialize = (obj: any): boolean => {
  for (const s of serializers) {
    if (s.$test$(obj)) {
      return true;
    }
  }
  return false;
};

export const collectDeps = (obj: any, collector: Collector, leaks: boolean | QwikElement) => {
  for (const s of collectorSerializers) {
    if (s.$test$(obj)) {
      s.$collect$!(obj, collector, leaks);
      return true;
    }
  }
  return false;
};

export const serializeValue = (
  obj: any,
  getObjID: MustGetObjID,
  collector: Collector,
  containerState: ContainerState
) => {
  for (const s of serializers) {
    if (s.$test$(obj)) {
      let value = s.$prefix$;
      if (s.$serialize$) {
        value += s.$serialize$(obj, getObjID, collector, containerState);
      }
      return value;
    }
  }
  return undefined;
};

export interface Parser {
  prepare(data: string): any;
  subs(obj: any, subs: Subscriptions[]): boolean;
  fill(obj: any, getObject: GetObject): boolean;
}

export const createParser = (containerState: ContainerState, doc: Document): Parser => {
  const fillMap = new Map<any, Serializer<any>>();
  const subsMap = new Map<any, Serializer<any>>();

  return {
    prepare(data: string) {
      for (const s of serializers) {
        const prefix = s.$prefix$;
        if (data.startsWith(prefix)) {
          const value = s.$prepare$(data.slice(prefix.length), containerState, doc);
          if (s.$fill$) {
            fillMap.set(value, s);
          }
          if (s.$subs$) {
            subsMap.set(value, s);
          }
          return value;
        }
      }
      return data;
    },
    subs(obj: any, subs: Subscriptions[]) {
      const serializer = subsMap.get(obj);
      if (serializer) {
        serializer.$subs$!(obj, subs, containerState);
        return true;
      }
      return false;
    },
    fill(obj: any, getObject: GetObject) {
      const serializer = fillMap.get(obj);
      if (serializer) {
        serializer.$fill$!(obj, getObject, containerState);
        return true;
      }
      return false;
    },
  };
};

export const OBJECT_TRANSFORMS: Record<string, (obj: any, containerState: ContainerState) => any> =
  {
    '!': (obj: any, containerState: ContainerState) => {
      return containerState.$proxyMap$.get(obj) ?? getOrCreateProxy(obj, containerState);
    },
    '~': (obj: any) => {
      return Promise.resolve(obj);
    },
    _: (obj: any) => {
      return Promise.reject(obj);
    },
  };

const isTreeShakeable = (
  manager: SubscriptionManager,
  target: LocalSubscriptionManager,
  leaks: QwikElement | boolean
) => {
  if (typeof leaks === 'boolean') {
    return leaks;
  }
  const localManager = manager.$groupToManagers$.get(leaks);
  if (localManager && localManager.length > 0) {
    if (localManager.length === 1) {
      return localManager[0] !== target;
    }
    return true;
  }
  return false;
};

const getResolveJSXType = (type: any) => {
  if (type === ':slot') {
    return Slot;
  }
  if (type === ':fragment') {
    return Fragment;
  }
  return type;
};
