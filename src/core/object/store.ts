import { CorePlatform, getPlatform } from '../index';
import { assertDefined, assertEqual } from '../assert/assert';
import { parseQRL, stringifyQRL } from '../import/qrl';
import { isQrl } from '../import/qrl-class';
import { getContext } from '../props/props';
import { getDocument } from '../util/dom';
import { isDocument, isElement } from '../util/element';
import { logError, logWarn } from '../util/log';
import { ELEMENT_ID, ELEMENT_ID_PREFIX, QHostAttr, QObjAttr } from '../util/markers';
import { qDev } from '../util/qdev';
import {
  getProxyMap,
  ObjToProxyMap,
  QOjectSubsSymbol,
  QOjectTargetSymbol,
  shouldSerialize,
  _restoreQObject,
} from './q-object';

export interface Store {
  doc: Document;
  objs: Record<string, any>;
}

export const UNDEFINED_PREFIX = '\u0010';
export const QRL_PREFIX = '\u0011';

export function resume(elmOrDoc: Element | Document) {
  const parentElm = isDocument(elmOrDoc) ? elmOrDoc.documentElement : elmOrDoc;
  if (!isRoot(parentElm)) {
    // logWarn('Skipping hydration because parent element is not q:container');
    return;
  }
  const doc = isDocument(elmOrDoc) ? elmOrDoc : getDocument(elmOrDoc);
  const isDoc = isDocument(elmOrDoc) || elmOrDoc === doc.documentElement;
  const parentJSON = isDoc ? doc.body : parentElm;
  const script = getQwikJSON(parentJSON);
  if (!script) {
    logWarn('Skipping hydration qwik/json metadata was not found.');
    return;
  }
  script.remove();

  const map = getProxyMap(doc);
  const meta = JSON.parse(script.textContent || '{}') as any;

  // Collect all elements
  const elements = new Map<string, Element>();
  getNodesInScope(parentElm, hasQId).forEach((el) => {
    const id = el.getAttribute(ELEMENT_ID)!;
    elements.set(ELEMENT_ID_PREFIX + id, el);
  });

  // Revive proxies with subscriptions into the proxymap
  reviveValues(meta.objs, meta.subs, elements, map);

  // Rebuild target objects
  for (const obj of meta.objs) {
    reviveNestedObjects(obj, elements, meta.objs, map);
  }

  // Walk all elements with q:obj and resume their state
  getNodesInScope(parentElm, hasQObj).forEach((el) => {
    const qobj = el.getAttribute(QObjAttr)!;
    const host = el.getAttribute(QHostAttr);
    const ctx = getContext(el);
    qobj.split(' ').forEach((part) => {
      if (part !== '') {
        const obj = getObject(part, elements, meta.objs, map);
        ctx.refMap.add(obj);
      } else if (qDev) {
        logError('QObj contains empty ref');
      }
    });
    if (host) {
      const [props, events] = host.split(' ').map(strToInt);
      assertDefined(props);
      assertDefined(events);
      ctx.props = ctx.refMap.get(props);
      ctx.events = ctx.refMap.get(events);
    }
  });
}

export function snapshotState(elmOrDoc: Element | Document) {
  const doc = isDocument(elmOrDoc) ? elmOrDoc : getDocument(elmOrDoc);
  const parentElm = isDocument(elmOrDoc) ? elmOrDoc.documentElement : elmOrDoc;
  const proxyMap = getProxyMap(doc);
  const objSet = new Set<any>();
  const platform = getPlatform(doc);
  const elementToIndex = new Map<Element, string | null>();

  // Collect all qObjected around the DOM
  const elements = getNodesInScope(parentElm, hasQObj);
  elements.forEach((node) => {
    const props = getContext(node);
    const qMap = props.refMap;
    qMap.array.forEach((v) => {
      collectQObjects(v, objSet, platform);
      objSet.add(normalizeObj(v, platform)); // Add root elements
    });
  });

  // Convert objSet to array
  const objs = Array.from(objSet);

  objs.sort((a, b) => {
    const isProxyA = proxyMap.has(a) ? 0 : 1;
    const isProxyB = proxyMap.has(b) ? 0 : 1;
    return isProxyA - isProxyB;
  });

  const objToId = new Map<any, number>();
  let count = 0;
  for (const obj of objs) {
    objToId.set(obj, count);
    count++;
  }

  function getElementID(el: Element): string | null {
    let id = elementToIndex.get(el);
    if (id === undefined) {
      if (el.isConnected) {
        id = intToStr(elementToIndex.size);
        el.setAttribute(ELEMENT_ID, id);
        id = ELEMENT_ID_PREFIX + id;
      } else {
        id = null;
      }
      elementToIndex.set(el, id);
    }
    return id;
  }

  function getObjId(obj: any): string | null {
    if (obj !== null && typeof obj === 'object') {
      const target = obj[QOjectTargetSymbol];
      const id = objToId.get(normalizeObj(target ?? obj, platform));
      if (id !== undefined) {
        const proxySuffix = target ? '!' : '';
        return intToStr(id) + proxySuffix;
      }
      if (!target && isElement(obj)) {
        return getElementID(obj);
      }
    } else {
      const id = objToId.get(normalizeObj(obj, platform));
      if (id !== undefined) {
        return intToStr(id);
      }
    }
    return null;
  }

  const subs = objs
    .map((obj) => {
      const subs = proxyMap.get(obj)?.[QOjectSubsSymbol] as Map<Element, Set<string>>;
      if (subs) {
        return Object.fromEntries(
          Array.from(subs.entries()).map(([el, set]) => {
            const id = getElementID(el);
            if (id !== null) {
              return [id, Array.from(set)];
            } else {
              return [undefined, undefined];
            }
          })
        );
      } else {
        return null;
      }
    })
    .filter((a) => !!a);

  const serialize = (value: any) => {
    return getObjId(value) ?? value;
  };

  const convertedObjs = objs.map((obj) => {
    if (Array.isArray(obj)) {
      return obj.map(serialize);
    } else if (obj && typeof obj === 'object') {
      const output: Record<string, any> = {};
      Object.entries(obj).forEach(([key, value]) => {
        output[key] = serialize(value);
      });
      return output;
    }
    return obj;
  });

  // Write back to the dom
  elements.forEach((node) => {
    const ctx = getContext(node);
    const props = ctx.props;
    const events = ctx.events;
    const attribute = ctx.refMap.array
      .map((obj) => {
        const id = getObjId(obj);
        assertDefined(id);
        return id;
      })
      .join(' ');
    node.setAttribute(QObjAttr, attribute);

    if (props) {
      const objs = [props];
      if (events) {
        objs.push(events);
      }
      node.setAttribute(QHostAttr, objs.map((obj) => ctx.refMap.indexOf(obj)).join(' '));
    }
  });

  // Sanity check of serialized element
  if (qDev) {
    elementToIndex.forEach((value, el) => {
      if (getDocument(el) !== doc) {
        logWarn('element from different document', value, el.tagName);
      }
      if (!value) {
        logWarn('unconnected element', el.tagName, '\n');
      }
    });
  }
  return {
    objs: convertedObjs,
    subs,
  };
}

export function getQwikJSON(parentElm: Element): HTMLScriptElement | undefined {
  let child = parentElm.lastElementChild;
  while (child) {
    if (child.tagName === 'SCRIPT' && child.getAttribute('type') === 'qwik/json') {
      return child as HTMLScriptElement;
    }
    child = child.previousElementSibling;
  }
  return undefined;
}

export function getNodesInScope(parent: Element, predicate: (el: Element) => boolean) {
  const nodes: Element[] = [];
  walkNodes(nodes, parent, predicate);
  return nodes;
}

export function walkNodes(nodes: Element[], parent: Element, predicate: (el: Element) => boolean) {
  let child = parent.firstElementChild;
  while (child) {
    if (!isRoot(child)) {
      if (predicate(child)) {
        nodes.push(child);
      }
      walkNodes(nodes, child, predicate);
    }
    child = child.nextElementSibling;
  }
}

function reviveValues(
  objs: any[],
  subs: any[],
  elementMap: Map<string, Element>,
  map: ObjToProxyMap
) {
  for (let i = 0; i < objs.length; i++) {
    const value = objs[i];
    if (typeof value === 'string') {
      if (value === UNDEFINED_PREFIX) {
        objs[i] = undefined;
      } else if (value.startsWith(QRL_PREFIX)) {
        objs[i] = parseQRL(value.slice(1));
      }
    } else {
      const sub = subs[i];
      if (sub) {
        const converted = new Map();
        Object.entries(sub).forEach((entry) => {
          const el = elementMap.get(entry[0]);
          if (!el) {
            logWarn(
              'QWIK can not revive subscriptions because of missing element ID',
              entry,
              value
            );
            return;
          }
          const set = new Set(entry[1] as any) as Set<string>;
          converted.set(el, set);
        });
        _restoreQObject(value, map, converted);
      }
    }
  }
}

function reviveNestedObjects(
  obj: any,
  elements: Map<string, Element>,
  objs: object[],
  map: ObjToProxyMap
) {
  if (obj && typeof obj == 'object') {
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        const value = obj[i];
        if (typeof value == 'string') {
          obj[i] = getObject(value, elements, objs, map);
        } else {
          reviveNestedObjects(value, elements, objs, map);
        }
      }
    } else if (Object.getPrototypeOf(obj) === Object.prototype) {
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          const value = obj[key];
          if (typeof value == 'string') {
            obj[key] = getObject(value, elements, objs, map);
          } else {
            reviveNestedObjects(value, elements, objs, map);
          }
        }
      }
    }
  }
}

function getObject(id: string, elements: Map<string, Element>, objs: any[], map: ObjToProxyMap) {
  if (id[0] === ELEMENT_ID_PREFIX) {
    assertEqual(elements.has(id), true);
    return elements.get(id);
  }
  const index = strToInt(id);
  assertEqual(objs.length > index, true);
  const obj = objs[index];
  const needsProxy = id[id.length - 1] === '!';
  if (needsProxy) {
    const finalObj = map.get(obj);
    assertDefined(finalObj);
    return finalObj;
  }
  return obj;
}

function normalizeObj(obj: any, platform: CorePlatform) {
  if (obj === undefined || !shouldSerialize(obj)) {
    return UNDEFINED_PREFIX;
  }
  if (obj && typeof obj === 'object') {
    const value = obj[QOjectTargetSymbol] ?? obj;
    if (isQrl(value)) {
      return QRL_PREFIX + stringifyQRL(obj, platform);
    }
    return value;
  }
  return obj;
}

function collectQObjects(obj: any, seen: Set<any>, platform: CorePlatform) {
  if (obj != null) {
    if (typeof obj === 'object') {
      if (!obj[QOjectTargetSymbol] && isElement(obj)) {
        return;
      }
      obj = normalizeObj(obj, platform);
    }
    if (typeof obj === 'object') {
      if (seen.has(obj)) return;
      seen.add(obj);

      if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
          collectQObjects(obj[i], seen, platform);
        }
      } else {
        for (const key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) {
            collectQObjects(obj[key], seen, platform);
          }
        }
      }
    }
    if (typeof obj === 'string') {
      seen.add(obj);
    }
  }
}

export function isProxy(obj: any): boolean {
  return obj !== null && typeof obj === 'object' && QOjectTargetSymbol in obj;
}

function isRoot(el: Element) {
  return el.hasAttribute('q:container');
}

function hasQObj(el: Element) {
  return el.hasAttribute(QObjAttr);
}

function hasQId(el: Element) {
  return el.hasAttribute(ELEMENT_ID);
}

export const intToStr = (nu: number) => {
  return nu.toString(36);
};

export const strToInt = (nu: string) => {
  return parseInt(nu, 36);
};
