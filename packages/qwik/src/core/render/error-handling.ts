import { isServer } from '../platform/platform';
import { createContext, resolveContext } from '../use/use-context';
import { qDev } from '../util/qdev';
import type { QwikElement } from './dom/virtual-element';
import type { RenderContext } from './types';

export interface ErrorBoundaryStore {
  error: any | undefined;
}

export const ERROR_CONTEXT = /*#__PURE__*/ createContext<ErrorBoundaryStore>('qk-error');

export const handleError = (err: any, hostElement: QwikElement, rctx?: RenderContext) => {
  if (qDev) {
    if (err && err instanceof Error) {
      if (!('hostElement' in err)) {
        (err as any)['hostElement'] = hostElement;
      }
    }
    if (!isRecoverable(err)) {
      throw err;
    }
  }
  if (isServer()) {
    throw err;
  } else {
    const errorStore = resolveContext(ERROR_CONTEXT, hostElement, rctx);
    if (errorStore === undefined) {
      throw err;
    }
    errorStore.error = err;
  }
};

const isRecoverable = (err: any) => {
  if (err && err instanceof Error) {
    if ('plugin' in err) {
      return false;
    }
  }
  return true;
};
