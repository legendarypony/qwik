import { assertDefined, assertTrue } from '../assert/assert';
import { isQrl } from '../import/qrl-class';
import { getContext, QContext, tryGetContext } from '../props/props';
import { getDocument } from '../util/dom';
import { isDocument, isElement, isNode, isQwikElement, isVirtualElement } from '../util/element';
import { logDebug, logWarn } from '../util/log';
import {
  ELEMENT_ID,
  ELEMENT_ID_PREFIX,
  QContainerAttr,
  QScopedStyle,
  QStyle,
} from '../util/markers';
import { qDev } from '../util/qdev';
import {
  createProxy,
  fastShouldSerialize,
  getOrCreateProxy,
  getProxyFlags,
  getProxySubs,
  getProxyTarget,
  isConnected,
} from './q-object';
import {
  destroyWatch,
  Subscriber,
  SubscriberDescriptor,
  WatchFlagsIsDirty,
} from '../use/use-watch';
import type { QRL } from '../import/qrl.public';
import { emitEvent } from '../util/event';
import {
  qError,
  QError_containerAlreadyPaused,
  QError_missingObjectId,
  QError_verifySerializable,
} from '../error/error';
import { isArray, isObject, isSerializableObject, isString } from '../util/types';
import { directGetAttribute, directSetAttribute } from '../render/fast-calls';
import { isNotNullable, isPromise } from '../util/promises';
import { isResourceReturn } from '../use/use-resource';
import { createParser, Parser, serializeValue, UNDEFINED_PREFIX } from './serializers';
import { ContainerState, getContainerState } from '../render/container';
import { getQId } from '../render/execute-component';
import { processVirtualNodes, QwikElement, VirtualElement } from '../render/dom/virtual-element';
import { getDomListeners } from '../props/props-on';
import { fromKebabToCamelCase } from '../util/case';
import { domToVnode } from '../render/dom/visitor';

export type GetObject = (id: string) => any;
export type GetObjID = (obj: any) => string | null;

// <docs markdown="../readme.md#pauseContainer">
// !!DO NOT EDIT THIS COMMENT DIRECTLY!!!
// (edit ../readme.md#pauseContainer instead)
/**
 * Serialize the current state of the application into DOM
 *
 * @alpha
 */
// </docs>
export const pauseContainer = async (
  elmOrDoc: Element | Document,
  defaultParentJSON?: Element
): Promise<SnapshotResult> => {
  const doc = getDocument(elmOrDoc);
  const documentElement = doc.documentElement;
  const containerEl = isDocument(elmOrDoc) ? documentElement : elmOrDoc;
  if (directGetAttribute(containerEl, QContainerAttr) === 'paused') {
    throw qError(QError_containerAlreadyPaused);
  }
  const parentJSON =
    defaultParentJSON ?? (containerEl === doc.documentElement ? doc.body : containerEl);
  const data = await pauseFromContainer(containerEl);
  const script = doc.createElement('script');
  directSetAttribute(script, 'type', 'qwik/json');
  script.textContent = escapeText(JSON.stringify(data.state, undefined, qDev ? '  ' : undefined));
  parentJSON.appendChild(script);
  directSetAttribute(containerEl, QContainerAttr, 'paused');
  return data;
};

export const moveStyles = (containerEl: Element, containerState: ContainerState) => {
  const head = containerEl.ownerDocument.head;
  containerEl.querySelectorAll('style[q\\:style]').forEach((el) => {
    containerState.$styleIds$.add(directGetAttribute(el, QStyle)!);
    head.appendChild(el);
  });
};

export const resumeContainer = (containerEl: Element) => {
  if (!isContainer(containerEl)) {
    logWarn('Skipping hydration because parent element is not q:container');
    return;
  }
  const doc = getDocument(containerEl);
  const isDocElement = containerEl === doc.documentElement;
  const parentJSON = isDocElement ? doc.body : containerEl;
  const script = getQwikJSON(parentJSON);
  if (!script) {
    logWarn('Skipping hydration qwik/json metadata was not found.');
    return;
  }
  script.remove();

  const containerState = getContainerState(containerEl);
  moveStyles(containerEl, containerState);
  const meta = JSON.parse(unescapeText(script.textContent || '{}')) as SnapshotState;

  // Collect all elements
  const elements = new Map<string, QwikElement>();

  const getObject: GetObject = (id) => {
    return getObjectImpl(id, elements, meta.objs, containerState);
  };

  let maxId = 0;
  getNodesInScope(containerEl, hasQId).forEach((el) => {
    const id = directGetAttribute(el, ELEMENT_ID);
    assertDefined(id, `resume: element missed q:id`, el);
    const ctx = getContext(el);
    ctx.$id$ = id;
    if (isElement(el)) {
      ctx.$vdom$ = domToVnode(el);
    }
    elements.set(ELEMENT_ID_PREFIX + id, el);
    maxId = Math.max(maxId, strToInt(id));
  });
  containerState.$elementIndex$ = ++maxId;

  const parser = createParser(getObject, containerState, doc);

  // Revive proxies with subscriptions into the proxymap
  reviveValues(meta.objs, meta.subs, getObject, containerState, parser);

  // Rebuild target objects
  for (const obj of meta.objs) {
    reviveNestedObjects(obj, getObject, parser);
  }

  for (const elementID of Object.keys(meta.ctx)) {
    assertTrue(elementID.startsWith('#'), 'elementId must start with #');
    const ctxMeta = meta.ctx[elementID];
    const el = elements.get(elementID);
    assertDefined(el, `resume: cant find dom node for id`, elementID);
    const ctx = getContext(el);
    const refMap = ctxMeta.r;
    const seq = ctxMeta.s;
    const host = ctxMeta.h;
    const contexts = ctxMeta.c;
    const watches = ctxMeta.w;

    if (refMap) {
      assertTrue(isElement(el), 'el must be an actual DOM element');
      ctx.$refMap$ = refMap.split(' ').map(getObject);
      ctx.li = getDomListeners(ctx, containerEl);
    }
    if (seq) {
      ctx.$seq$ = seq.split(' ').map(getObject);
    }
    if (watches) {
      ctx.$watches$ = watches.split(' ').map(getObject);
    }
    if (contexts) {
      ctx.$contexts$ = new Map();
      for (const part of contexts.split(' ')) {
        const [key, value] = part.split('=');
        ctx.$contexts$.set(key, getObject(value));
      }
    }

    // Restore sequence scoping
    if (host) {
      const [props, renderQrl] = host.split(' ');
      const styleIds = el.getAttribute(QScopedStyle);
      assertDefined(props, `resume: props missing in host metadata`, host);
      assertDefined(renderQrl, `resume: renderQRL missing in host metadata`, host);
      ctx.$scopeIds$ = styleIds ? styleIds.split(' ') : null;
      ctx.$mounted$ = true;
      ctx.$props$ = getObject(props);
      ctx.$componentQrl$ = getObject(renderQrl);
    }
  }

  directSetAttribute(containerEl, QContainerAttr, 'resumed');
  logDebug('Container resumed');
  emitEvent(containerEl, 'qresume', undefined, true);
};

/**
 * @alpha
 */
export interface SnapshotMetaValue {
  r?: string; // q:obj
  w?: string; // q:watches
  s?: string; // q:seq
  h?: string; // q:host
  c?: string; // q:context
}

/**
 * @alpha
 */
export type SnapshotMeta = Record<string, SnapshotMetaValue>;

/**
 * @alpha
 */
export interface SnapshotState {
  ctx: SnapshotMeta;
  objs: any[];
  subs: any[];
}

/**
 * @alpha
 */
export interface SnapshotListener {
  key: string;
  eventName: string;
  qrl: QRL<any>;
  el: Element;
}

/**
 * @alpha
 */
export interface SnapshotResult {
  state: SnapshotState;
  listeners: SnapshotListener[];
  objs: any[];
  mode: 'render' | 'listeners' | 'static';
}

export const pauseFromContainer = async (containerEl: Element): Promise<SnapshotResult> => {
  const containerState = getContainerState(containerEl);
  const contexts = getNodesInScope(containerEl, hasQId).map(tryGetContext) as QContext[];
  return _pauseFromContexts(contexts, containerState);
};

/**
 * @internal
 */
export const _pauseFromContexts = async (
  allContexts: QContext[],
  containerState: ContainerState
): Promise<SnapshotResult> => {
  const collector = createCollector(containerState);
  const listeners: SnapshotListener[] = [];
  for (const ctx of allContexts) {
    const el = ctx.$element$;
    const ctxLi = ctx.li;
    for (const key of Object.keys(ctxLi)) {
      for (const qrl of ctxLi[key]) {
        const captured = qrl.$captureRef$;
        if (captured) {
          for (const obj of captured) {
            collectValue(obj, collector, true);
          }
        }
        if (isElement(el)) {
          listeners.push({
            key,
            qrl,
            el,
            eventName: getEventName(key),
          });
        }
      }
    }
    if (ctx.$watches$) {
      collector.$watches$.push(...ctx.$watches$);
    }
  }

  // No listeners implies static page
  if (listeners.length === 0) {
    return {
      state: {
        ctx: {},
        objs: [],
        subs: [],
      },
      objs: [],
      listeners: [],
      mode: 'static',
    };
  }

  // Wait for remaining promises
  let promises: Promise<any>[];
  while ((promises = collector.$promises$).length > 0) {
    collector.$promises$ = [];
    await Promise.allSettled(promises);
  }

  // If at this point any component can render, we need to capture Context and Props
  const canRender = collector.$elements$.length > 0;
  if (canRender) {
    for (const element of collector.$elements$) {
      collectElementData(tryGetContext(element)!, collector);
    }

    for (const ctx of allContexts) {
      if (ctx.$props$) {
        collectProps(ctx, collector);
      }
      if (ctx.$contexts$) {
        for (const item of ctx.$contexts$.values()) {
          collectValue(item, collector, false);
        }
      }
    }
  }

  // Wait for remaining promises
  while ((promises = collector.$promises$).length > 0) {
    collector.$promises$ = [];
    await Promise.allSettled(promises);
  }

  // Convert objSet to array
  const elementToIndex = new Map<QwikElement, string | null>();
  const objs = Array.from(collector.$objSet$.keys());
  const objToId = new Map<any, string>();

  const getElementID = (el: QwikElement): string | null => {
    let id = elementToIndex.get(el);
    if (id === undefined) {
      id = getQId(el);
      if (!id) {
        console.warn('Missing ID', el);
      } else {
        id = ELEMENT_ID_PREFIX + id;
      }
      elementToIndex.set(el, id);
    }
    return id;
  };

  const getObjId = (obj: any): string | null => {
    let suffix = '';
    if (isPromise(obj)) {
      const { value, resolved } = getPromiseValue(obj);
      obj = value;
      if (resolved) {
        suffix += '~';
      } else {
        suffix += '_';
      }
    }

    if (isObject(obj)) {
      const target = getProxyTarget(obj);
      if (target) {
        suffix += '!';
        obj = target;
      } else if (isQwikElement(obj)) {
        const elID = getElementID(obj);
        if (elID) {
          return elID + suffix;
        }
        return null;
      }
    }
    const id = objToId.get(obj);
    if (id) {
      return id + suffix;
    }
    return null;
  };

  const mustGetObjId = (obj: any): string => {
    const key = getObjId(obj);
    if (key === null) {
      throw qError(QError_missingObjectId, obj);
    }
    return key;
  };

  // Compute subscriptions
  const subsMap = new Map<
    any,
    { subscriber: Subscriber | '$'; data: string[] | number | null }[]
  >();
  objs.forEach((obj) => {
    const proxy = containerState.$proxyMap$.get(obj);
    const flags = getProxyFlags(proxy);
    if (flags === undefined) {
      return;
    }
    const subsObj: { subscriber: Subscriber | '$'; data: string[] | number | null }[] = [];
    if (flags > 0) {
      subsObj.push({
        subscriber: '$',
        data: flags,
      });
    }
    const subs = getProxySubs(proxy);
    assertDefined(subs, 'subs must be defined');
    subs.forEach((set, key) => {
      if (isNode(key) && isVirtualElement(key)) {
        if (!collector.$elements$.includes(key)) {
          return;
        }
      }
      subsObj.push({
        subscriber: key,
        data: set ? Array.from(set) : null,
      });
    });
    if (subsObj.length > 0) {
      subsMap.set(obj, subsObj);
    }
  });

  // Sort objects: the ones with subscriptions go first
  objs.sort((a, b) => {
    const isProxyA = subsMap.has(a) ? 0 : 1;
    const isProxyB = subsMap.has(b) ? 0 : 1;
    return isProxyA - isProxyB;
  });

  // Generate object ID by using a monotonic counter
  let count = 0;
  for (const obj of objs) {
    objToId.set(obj, intToStr(count));
    count++;
  }
  if (collector.$noSerialize$.length > 0) {
    const undefinedID = objToId.get(undefined);
    assertDefined(undefinedID, 'undefined ID must be defined');
    for (const obj of collector.$noSerialize$) {
      objToId.set(obj, undefinedID);
    }
  }

  // Serialize object subscriptions
  const subs = objs
    .map((obj) => {
      const sub = subsMap.get(obj);
      if (!sub) {
        return undefined;
      }
      const subsObj: Record<string, string[] | number | null> = {};
      sub.forEach(({ subscriber, data }) => {
        if (subscriber === '$') {
          subsObj[subscriber] = data;
        } else {
          const id = getObjId(subscriber);
          if (id !== null) {
            subsObj[id] = data;
          }
        }
      });
      return subsObj;
    })
    .filter(isNotNullable);

  // Serialize objects
  const convertedObjs = objs.map((obj) => {
    if (obj === null) {
      return null;
    }
    const typeObj = typeof obj;
    switch (typeObj) {
      case 'undefined':
        return UNDEFINED_PREFIX;
      case 'string':
      case 'number':
      case 'boolean':
        return obj;

      default:
        const value = serializeValue(obj, getObjId, containerState);
        if (value !== undefined) {
          return value;
        }
        if (typeObj === 'object') {
          if (isArray(obj)) {
            return obj.map(mustGetObjId);
          }
          if (isSerializableObject(obj)) {
            const output: Record<string, any> = {};
            for (const key of Object.keys(obj)) {
              output[key] = mustGetObjId(obj[key]);
            }
            return output;
          }
        }
        break;
    }
    throw qError(QError_verifySerializable, obj);
  });

  const meta: SnapshotMeta = {};

  // Write back to the dom
  allContexts.forEach((ctx) => {
    assertDefined(ctx, `pause: missing context for dom node`);
    const node = ctx.$element$;
    const ref = ctx.$refMap$;
    const props = ctx.$props$;
    const contexts = ctx.$contexts$;
    const watches = ctx.$watches$;
    const renderQrl = ctx.$componentQrl$;
    const seq = ctx.$seq$;
    const metaValue: SnapshotMetaValue = {};
    const elementCaptured = isVirtualElement(node) && collector.$elements$.includes(node);

    let add = false;
    if (ref.length > 0) {
      const value = ref.map(mustGetObjId).join(' ');
      if (value) {
        metaValue.r = value;
        add = true;
      }
    }

    if (canRender) {
      if (elementCaptured && props) {
        metaValue.h = mustGetObjId(props) + ' ' + mustGetObjId(renderQrl);
        add = true;
      }

      if (watches && watches.length > 0) {
        const value = watches.map(getObjId).filter(isNotNullable).join(' ');
        if (value) {
          metaValue.w = value;
          add = true;
        }
      }

      if (elementCaptured && seq && seq.length > 0) {
        const value = seq.map(mustGetObjId).join(' ');
        metaValue.s = value;
        add = true;
      }

      if (contexts) {
        const serializedContexts: string[] = [];
        contexts.forEach((value, key) => {
          serializedContexts.push(`${key}=${mustGetObjId(value)}`);
        });
        const value = serializedContexts.join(' ');
        if (value) {
          metaValue.c = value;
          add = true;
        }
      }
    }

    if (add) {
      const elementID = getElementID(node);
      assertDefined(elementID, `pause: can not generate ID for dom node`, node);
      meta[elementID] = metaValue;
    }
  });

  for (const watch of collector.$watches$) {
    if (qDev) {
      if (watch.$flags$ & WatchFlagsIsDirty) {
        logWarn('Serializing dirty watch. Looks like an internal error.');
      }
      if (!isConnected(watch)) {
        logWarn('Serializing disconneted watch. Looks like an internal error.');
      }
    }
    destroyWatch(watch);
  }

  // Sanity check of serialized element
  if (qDev) {
    elementToIndex.forEach((value, el) => {
      if (!value) {
        logWarn('unconnected element', el.nodeName, '\n');
      }
    });
  }

  return {
    state: {
      ctx: meta,
      objs: convertedObjs,
      subs,
    },
    objs,
    listeners,
    mode: canRender ? 'render' : 'listeners',
  };
};

export const getQwikJSON = (parentElm: Element): HTMLScriptElement | undefined => {
  let child = parentElm.lastElementChild;
  while (child) {
    if (child.tagName === 'SCRIPT' && directGetAttribute(child, 'type') === 'qwik/json') {
      return child as HTMLScriptElement;
    }
    child = child.previousElementSibling;
  }
  return undefined;
};

const SHOW_ELEMENT = 1;
const SHOW_COMMENT = 128;
const FILTER_ACCEPT = 1;
const FILTER_REJECT = 2;
const FILTER_SKIP = 3;

export const getNodesInScope = (parent: Element, predicate: (el: Node) => boolean) => {
  const nodes: Element[] = [];
  if (predicate(parent)) {
    nodes.push(parent);
  }
  const walker = parent.ownerDocument.createTreeWalker(parent, SHOW_ELEMENT | SHOW_COMMENT, {
    acceptNode(node) {
      if (isContainer(node)) {
        return FILTER_REJECT;
      }
      return predicate(node) ? FILTER_ACCEPT : FILTER_SKIP;
    },
  });
  const pars: QwikElement[] = [];
  let currentNode: Node | null = null;
  while ((currentNode = walker.nextNode())) {
    pars.push(processVirtualNodes(currentNode) as Element);
  }
  return pars;
};

const reviveValues = (
  objs: any[],
  subs: any[],
  getObject: GetObject,
  containerState: ContainerState,
  parser: Parser
) => {
  for (let i = 0; i < objs.length; i++) {
    const value = objs[i];
    if (isString(value)) {
      objs[i] = value === UNDEFINED_PREFIX ? undefined : parser.prepare(value);
    }
  }
  for (let i = 0; i < subs.length; i++) {
    const value = objs[i];
    const sub = subs[i];
    if (sub) {
      const converted = new Map();
      let flags = 0;
      for (const key of Object.keys(sub)) {
        const v = sub[key];
        if (key === '$') {
          flags = v as number;
          continue;
        }
        const el = getObject(key);
        if (!el) {
          logWarn('QWIK can not revive subscriptions because of missing element ID', key, value);
          continue;
        }
        const set = v === null ? null : (new Set(v as any) as Set<string>);
        converted.set(el, set);
      }
      createProxy(value, containerState, flags, converted);
    }
  }
};

const reviveNestedObjects = (obj: any, getObject: GetObject, parser: Parser) => {
  if (parser.fill(obj)) {
    return;
  }

  if (obj && typeof obj == 'object') {
    if (isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        const value = obj[i];
        if (typeof value == 'string') {
          obj[i] = getObject(value);
        } else {
          reviveNestedObjects(value, getObject, parser);
        }
      }
    } else if (isSerializableObject(obj)) {
      for (const key of Object.keys(obj)) {
        const value = obj[key];
        if (typeof value == 'string') {
          obj[key] = getObject(value);
        } else {
          reviveNestedObjects(value, getObject, parser);
        }
      }
    }
  }
};

const OBJECT_TRANSFORMS: Record<string, (obj: any, containerState: ContainerState) => any> = {
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

const getObjectImpl = (
  id: string,
  elements: Map<string, QwikElement>,
  objs: any[],
  containerState: ContainerState
) => {
  assertTrue(
    typeof id === 'string' && id.length > 0,
    'resume: id must be an non-empty string, got:',
    id
  );

  if (id.startsWith(ELEMENT_ID_PREFIX)) {
    assertTrue(elements.has(id), `missing element for id:`, id);
    return elements.get(id);
  }
  const index = strToInt(id);
  assertTrue(objs.length > index, 'resume: index is out of bounds', id);
  let obj = objs[index];
  for (let i = id.length - 1; i >= 0; i--) {
    const code = id[i];
    const transform = OBJECT_TRANSFORMS[code];
    if (!transform) {
      break;
    }
    obj = transform(obj, containerState);
  }
  return obj;
};

const collectProps = (elCtx: QContext, collector: Collector) => {
  const parentCtx = elCtx.$parent$;
  if (parentCtx && elCtx.$props$ && collector.$elements$.includes(parentCtx.$element$ as any)) {
    const subs = getProxySubs(elCtx.$props$);
    const el = elCtx.$element$ as VirtualElement;
    if (subs && subs.has(el)) {
      collectElement(el, collector);
    }
  }
};

export interface Collector {
  $seen$: Set<any>;
  $objSet$: Set<any>;
  $noSerialize$: any[];
  $elements$: VirtualElement[];
  $watches$: SubscriberDescriptor[];
  $containerState$: ContainerState;
  $promises$: Promise<any>[];
}

const createCollector = (containerState: ContainerState): Collector => {
  return {
    $containerState$: containerState,
    $seen$: new Set(),
    $objSet$: new Set(),
    $noSerialize$: [],
    $elements$: [],
    $watches$: [],
    $promises$: [],
  };
};

const collectDeferElement = (el: VirtualElement, collector: Collector) => {
  if (collector.$elements$.includes(el)) {
    return;
  }
  collector.$elements$.push(el);
};

const collectElement = (el: VirtualElement, collector: Collector) => {
  if (collector.$elements$.includes(el)) {
    return;
  }
  const ctx = tryGetContext(el);
  if (ctx) {
    collector.$elements$.push(el);
    collectElementData(ctx, collector);
  }
};

export const collectElementData = (ctx: QContext, collector: Collector) => {
  if (ctx.$props$) {
    collectValue(ctx.$props$, collector, false);
  }
  if (ctx.$componentQrl$) {
    collectValue(ctx.$componentQrl$, collector, false);
  }
  if (ctx.$seq$) {
    for (const obj of ctx.$seq$) {
      collectValue(obj, collector, false);
    }
  }
  if (ctx.$watches$) {
    for (const obj of ctx.$watches$) {
      collectValue(obj, collector, false);
    }
  }
  if (ctx.$contexts$) {
    for (const obj of ctx.$contexts$.values()) {
      collectValue(obj, collector, false);
    }
  }
};

export const escapeText = (str: string) => {
  return str.replace(/<(\/?script)/g, '\\x3C$1');
};

export const unescapeText = (str: string) => {
  return str.replace(/\\x3C(\/?script)/g, '<$1');
};

const collectSubscriptions = (proxy: any, collector: Collector) => {
  const subs = getProxySubs(proxy);
  assertDefined(subs, 'subs must be defined');
  if (collector.$seen$.has(subs)) {
    return;
  }
  collector.$seen$.add(subs);
  for (const key of Array.from(subs.keys())) {
    if (isNode(key) && isVirtualElement(key)) {
      collectDeferElement(key, collector);
    } else {
      collectValue(key, collector, true);
    }
  }
};

const PROMISE_VALUE = Symbol();

interface PromiseValue {
  resolved: boolean;
  value: any;
}
const resolvePromise = (promise: Promise<any>) => {
  return promise.then(
    (value) => {
      const v: PromiseValue = {
        resolved: true,
        value,
      };
      (promise as any)[PROMISE_VALUE] = v;
      return value;
    },
    (value) => {
      const v: PromiseValue = {
        resolved: false,
        value,
      };
      (promise as any)[PROMISE_VALUE] = v;
      return value;
    }
  );
};

const getPromiseValue = (promise: Promise<any>): PromiseValue => {
  assertTrue(PROMISE_VALUE in promise, 'pause: promise was not resolved previously', promise);
  return (promise as any)[PROMISE_VALUE];
};

const collectValue = (obj: any, collector: Collector, leaks: boolean) => {
  if (obj !== null) {
    const objType = typeof obj;
    const seen = collector.$seen$;
    switch (objType) {
      case 'function': {
        if (seen.has(obj)) {
          return;
        }
        seen.add(obj);
        if (!fastShouldSerialize(obj)) {
          collector.$objSet$.add(undefined);
          collector.$noSerialize$.push(obj);
          return;
        }
        if (isQrl(obj)) {
          collector.$objSet$.add(obj);
          if (obj.$captureRef$) {
            for (const item of obj.$captureRef$) {
              collectValue(item, collector, leaks);
            }
          }
          return;
        }
        break;
      }
      case 'object': {
        if (seen.has(obj)) {
          return;
        }
        seen.add(obj);
        if (!fastShouldSerialize(obj)) {
          collector.$objSet$.add(undefined);
          collector.$noSerialize$.push(obj);
          return;
        }
        if (isPromise(obj)) {
          collector.$promises$.push(
            resolvePromise(obj).then((value) => {
              collectValue(value, collector, leaks);
            })
          );
          return;
        }

        const target = getProxyTarget(obj);
        const input = obj;

        // If proxy collect subscriptions
        if (target) {
          if (leaks) {
            collectSubscriptions(input, collector);
          }
          obj = target;
          if (seen.has(obj)) {
            return;
          }
          seen.add(obj);

          if (isResourceReturn(obj)) {
            collector.$objSet$.add(target);
            collectValue(obj.promise, collector, leaks);
            collectValue(obj.resolved, collector, leaks);
            return;
          }
        } else if (isNode(obj)) {
          return;
        }
        if (isArray(obj)) {
          for (let i = 0; i < obj.length; i++) {
            collectValue(input[i], collector, leaks);
          }
        } else {
          for (const key of Object.keys(obj)) {
            collectValue(input[key], collector, leaks);
          }
        }
        break;
      }
    }
  }
  collector.$objSet$.add(obj);
};

export const isContainer = (el: Node) => {
  return isElement(el) && el.hasAttribute(QContainerAttr);
};

const hasQId = (el: Node) => {
  const node = processVirtualNodes(el);
  if (isQwikElement(node)) {
    return node.hasAttribute(ELEMENT_ID);
  }
  return false;
};

export const intToStr = (nu: number) => {
  return nu.toString(36);
};

export const strToInt = (nu: string) => {
  return parseInt(nu, 36);
};

export const getEventName = (attribute: string) => {
  const colonPos = attribute.indexOf(':');
  assertTrue(colonPos >= 0, 'colon not found in attribute');
  return fromKebabToCamelCase(attribute.slice(colonPos + 1));
};
