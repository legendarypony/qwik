import { inflateQrl, parseQRL } from '../qrl/qrl';
import { assertQrl, isQrl, QRLInternal } from '../qrl/qrl-class';
import { $ } from '../qrl/qrl.public';
import { isArray } from '../util/types';
import { assertTrue } from '../error/assert';
import { EMPTY_ARRAY } from '../util/flyweight';
import { qRuntimeQrl, qSerialize } from '../util/qdev';
import { fromCamelToKebabCase } from '../util/case';
import type { QContext } from './context';

const ON_PROP_REGEX = /^(on|window:|document:)/;

export type Listener = [eventName: string, qrl: QRLInternal];

export const PREVENT_DEFAULT = 'preventdefault:';

export const isOnProp = (prop: string): boolean => {
  return prop.endsWith('$') && ON_PROP_REGEX.test(prop);
};

export const addQRLListener = (listeners: Listener[], add: Listener[]) => {
  for (const entry of add) {
    const prop = entry[0];
    const hash = entry[1].$hash$;
    let replaced = false;
    for (let i = 0; i < listeners.length; i++) {
      const existing = listeners[i];
      if (existing[0] === prop && existing[1].$hash$ === hash) {
        listeners.splice(i, 1, entry);
        replaced = true;
        break;
      }
    }
    if (!replaced) {
      listeners.push(entry);
    }
  }
};

export const groupListeners = (listeners: Listener[]): [string, QRLInternal[]][] => {
  if (listeners.length === 0) {
    return EMPTY_ARRAY;
  }
  if (listeners.length === 1) {
    const listener = listeners[0];
    return [[listener[0], [listener[1]]]];
  }

  const keys: string[] = [];
  for (let i = 0; i < listeners.length; i++) {
    const eventName = listeners[i][0];
    if (!keys.includes(eventName)) {
      keys.push(eventName);
    }
  }
  return keys.map((eventName) => {
    return [eventName, listeners.filter((l) => l[0] === eventName).map((a) => a[1])];
  });
};

export const setEvent = (
  existingListeners: Listener[],
  prop: string,
  input: any,
  containerEl: Element | undefined
) => {
  assertTrue(prop.endsWith('$'), 'render: event property does not end with $', prop);
  prop = normalizeOnProp(prop.slice(0, -1));
  if (input) {
    const listeners = isArray(input)
      ? input.map((q) => [prop, ensureQrl(q, containerEl)] as Listener)
      : ([[prop, ensureQrl(input, containerEl)]] as Listener[]);
    addQRLListener(existingListeners, listeners);
  }
  return prop;
};

const PREFIXES = ['on', 'window:on', 'document:on'];
const SCOPED = ['on', 'on-window', 'on-document'];

export const normalizeOnProp = (prop: string) => {
  let scope = 'on';
  for (let i = 0; i < PREFIXES.length; i++) {
    const prefix = PREFIXES[i];
    if (prop.startsWith(prefix)) {
      scope = SCOPED[i];
      prop = prop.slice(prefix.length);
      break;
    }
  }
  if (prop.startsWith('-')) {
    prop = fromCamelToKebabCase(prop.slice(1));
  } else {
    prop = prop.toLowerCase();
  }
  return scope + ':' + prop;
};

const ensureQrl = (value: any, containerEl: Element | undefined) => {
  if (qSerialize && !qRuntimeQrl) {
    assertQrl(value);
    value.$setContainer$(containerEl);
    return value;
  }
  const qrl = isQrl(value) ? value : ($(value) as QRLInternal);
  qrl.$setContainer$(containerEl);
  return qrl;
};

export const getDomListeners = (elCtx: QContext, containerEl: Element): Listener[] => {
  const attributes = (elCtx.$element$ as Element).attributes;
  const listeners: Listener[] = [];
  for (let i = 0; i < attributes.length; i++) {
    const { name, value } = attributes.item(i)!;
    if (
      name.startsWith('on:') ||
      name.startsWith('on-window:') ||
      name.startsWith('on-document:')
    ) {
      const urls = value.split('\n');
      for (const url of urls) {
        const qrl = parseQRL(url, containerEl);
        if (qrl.$capture$) {
          inflateQrl(qrl, elCtx);
        }
        listeners.push([name, qrl]);
      }
    }
  }
  return listeners;
};
