import { verifySerializable } from '../state/common';
import { getContext, type QContext } from '../state/context';
import { qDev, qSerialize } from '../util/qdev';
import { type RenderInvokeContext, useInvokeContext } from './use-core';

export interface SequentialScope<T> {
  readonly get: T | undefined;
  readonly set: (v: T) => T;
  readonly i: number;
  readonly iCtx: RenderInvokeContext;
  readonly elCtx: QContext;
}

export const useSequentialScope = <T>(): SequentialScope<T> => {
  const iCtx = useInvokeContext();
  const i = iCtx.$seq$;
  const hostElement = iCtx.$hostElement$;
  const elCtx = getContext(hostElement, iCtx.$renderCtx$.$static$.$containerState$);
  const seq = elCtx.$seq$ ? elCtx.$seq$ : (elCtx.$seq$ = []);

  iCtx.$seq$++;
  const set = (value: T) => {
    if (qDev && qSerialize) {
      verifySerializable(value);
    }
    return (seq[i] = value);
  };
  return {
    get: seq[i],
    set,
    i,
    iCtx,
    elCtx,
  };
};
