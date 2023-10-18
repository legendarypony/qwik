import { assertDefined } from '../error/assert';
import { RenderEvent } from '../util/markers';
import { maybeThen, promiseAllLazy, safeCall } from '../util/promises';
import { newInvokeContext } from '../use/use-core';
import { isArray, isFunction, isString, type ValueOrPromise } from '../util/types';
import type { JSXNode } from './jsx/types/jsx-node';
import type { ClassList } from './jsx/types/jsx-qwik-attributes';
import type { RenderContext } from './types';
import { type ContainerState, intToStr } from '../container/container';
import { fromCamelToKebabCase } from '../util/case';
import { qError, QError_stringifyClassOrStyle } from '../error/error';
import { seal } from '../util/qdev';
import { SkipRender } from './jsx/utils.public';
import { handleError } from './error-handling';
import { HOST_FLAG_DIRTY, HOST_FLAG_MOUNTED, type QContext } from '../state/context';
import { isSignal, SignalUnassignedException } from '../state/signal';
import { isJSXNode } from './jsx/jsx-runtime';

export interface ExecuteComponentOutput {
  node: JSXNode | null;
  rCtx: RenderContext;
}

export const executeComponent = (
  rCtx: RenderContext,
  elCtx: QContext
): ValueOrPromise<ExecuteComponentOutput> => {
  elCtx.$flags$ &= ~HOST_FLAG_DIRTY;
  elCtx.$flags$ |= HOST_FLAG_MOUNTED;
  elCtx.$slots$ = [];
  elCtx.li.length = 0;

  const hostElement = elCtx.$element$;
  const componentQRL = elCtx.$componentQrl$;
  const props = elCtx.$props$;
  const iCtx = newInvokeContext(rCtx.$static$.$locale$, hostElement, undefined, RenderEvent);
  const waitOn = (iCtx.$waitOn$ = []);
  assertDefined(componentQRL, `render: host element to render must have a $renderQrl$:`, elCtx);
  assertDefined(props, `render: host element to render must have defined props`, elCtx);

  // Set component context
  const newCtx = pushRenderContext(rCtx);
  newCtx.$cmpCtx$ = elCtx;
  newCtx.$slotCtx$ = null;

  // Invoke render hook
  iCtx.$subscriber$ = [0, hostElement];
  iCtx.$renderCtx$ = rCtx;

  // Resolve render function
  componentQRL.$setContainer$(rCtx.$static$.$containerState$.$containerEl$);
  const componentFn = componentQRL.getFn(iCtx);

  return safeCall(
    () => componentFn(props),
    (jsxNode) => {
      return maybeThen(promiseAllLazy(waitOn), () => {
        if (elCtx.$flags$ & HOST_FLAG_DIRTY) {
          return executeComponent(rCtx, elCtx);
        }
        return {
          node: jsxNode,
          rCtx: newCtx,
        };
      });
    },
    (err) => {
      if (err === SignalUnassignedException) {
        return maybeThen(promiseAllLazy(waitOn), () => {
          return executeComponent(rCtx, elCtx);
        });
      }
      handleError(err, hostElement, rCtx);
      return {
        node: SkipRender,
        rCtx: newCtx,
      };
    }
  );
};

export const createRenderContext = (
  doc: Document,
  containerState: ContainerState
): RenderContext => {
  const ctx: RenderContext = {
    $static$: {
      $doc$: doc,
      $locale$: containerState.$serverData$.locale,
      $containerState$: containerState,
      $hostElements$: new Set(),
      $operations$: [],
      $postOperations$: [],
      $roots$: [],
      $addSlots$: [],
      $rmSlots$: [],
      $visited$: [],
    },
    $cmpCtx$: null,
    $slotCtx$: null,
  };
  seal(ctx);
  seal(ctx.$static$);
  return ctx;
};

export const pushRenderContext = (ctx: RenderContext): RenderContext => {
  const newCtx: RenderContext = {
    $static$: ctx.$static$,
    $cmpCtx$: ctx.$cmpCtx$,
    $slotCtx$: ctx.$slotCtx$,
  };
  return newCtx;
};

export const serializeClassWithHost = (
  obj: ClassList,
  hostCtx: QContext | undefined | null
): string => {
  if (hostCtx && hostCtx.$scopeIds$) {
    return hostCtx.$scopeIds$.join(' ') + ' ' + serializeClass(obj);
  }
  return serializeClass(obj);
};

export const serializeClass = (obj: ClassList): string => {
  if (!obj) {
    return '';
  }
  if (isString(obj)) {
    return obj.trim();
  }

  const classes: string[] = [];

  if (isArray(obj)) {
    for (const o of obj) {
      const classList = serializeClass(o);
      if (classList) {
        classes.push(classList);
      }
    }
  } else {
    for (const [key, value] of Object.entries(obj)) {
      if (value) {
        classes.push(key.trim());
      }
    }
  }

  return classes.join(' ');
};

export const stringifyStyle = (obj: any): string => {
  if (obj == null) {
    return '';
  }
  if (typeof obj == 'object') {
    if (isArray(obj)) {
      throw qError(QError_stringifyClassOrStyle, obj, 'style');
    } else {
      const chunks: string[] = [];
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          const value = obj[key];
          if (value != null) {
            const normalizedKey = key.startsWith('--') ? key : fromCamelToKebabCase(key);
            chunks.push(normalizedKey + ':' + value);
          }
        }
      }
      return chunks.join(';');
    }
  }
  return String(obj);
};

export const getNextIndex = (ctx: RenderContext) => {
  return intToStr(ctx.$static$.$containerState$.$elementIndex$++);
};

export const setQId = (rCtx: RenderContext, elCtx: QContext) => {
  const id = getNextIndex(rCtx);
  elCtx.$id$ = id;
};

export const jsxToString = (data: any): string => {
  if (isSignal(data)) {
    return jsxToString(data.value);
  }
  return data == null || typeof data === 'boolean' ? '' : String(data);
};

export function isAriaAttribute(prop: string): boolean {
  return prop.startsWith('aria-');
}

export const shouldWrapFunctional = (res: unknown, node: JSXNode) => {
  if (node.key) {
    return !isJSXNode(res) || (!isFunction(res.type) && res.key != node.key);
  }
  return false;
};

export const static_listeners = 1 << 0;
export const static_subtree = 1 << 1;
export const dangerouslySetInnerHTML = 'dangerouslySetInnerHTML';
