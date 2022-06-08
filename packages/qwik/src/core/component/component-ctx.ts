import { assertDefined } from '../assert/assert';
import type { RenderContext } from '../render/cursor';
import { visitJsxNode } from '../render/render';
import { ComponentScopedStyles, QHostAttr, RenderEvent } from '../util/markers';
import { promiseAll, then } from '../util/promises';
import { styleContent, styleHost } from './qrl-styles';
import { newInvokeContext } from '../use/use-core';
import { processNode } from '../render/jsx/jsx-runtime';
import { logDebug, logError } from '../util/log';
import type { ValueOrPromise } from '../util/types';
import type { QContext } from '../props/props';

export const firstRenderComponent = (rctx: RenderContext, ctx: QContext): ValueOrPromise<void> => {
  ctx.element.setAttribute(QHostAttr, '');
  return renderComponent(rctx, ctx);
};

export const renderComponent = (rctx: RenderContext, ctx: QContext): ValueOrPromise<void> => {
  ctx.dirty = false;

  const hostElement = ctx.element;
  const onRenderQRL = ctx.renderQrl!;
  assertDefined(onRenderQRL);

  const props = ctx.props;
  assertDefined(props);

  // Component is not dirty any more
  rctx.containerState.hostsStaging.delete(hostElement);

  const newCtx: RenderContext = {
    ...rctx,
    components: [...rctx.components],
  };

  // Invoke render hook
  const invocatinContext = newInvokeContext(rctx.doc, hostElement, hostElement, RenderEvent);
  invocatinContext.subscriber = hostElement;
  invocatinContext.renderCtx = newCtx;
  const waitOn = (invocatinContext.waitOn = [] as any[]);

  // Clean current subscription before render
  rctx.containerState.subsManager.clearSub(hostElement);

  // Resolve render function
  const onRenderFn = onRenderQRL.invokeFn(rctx.containerEl, invocatinContext);

  try {
    // Execution of the render function
    const renderPromise = onRenderFn(props);

    // Wait for results
    return then(
      renderPromise,
      (jsxNode) => {
        rctx.hostElements.add(hostElement);
        const waitOnPromise = promiseAll(waitOn);
        return then(waitOnPromise, () => {
          if (typeof jsxNode === 'function') {
            ctx.dirty = false;
            jsxNode = jsxNode();
          } else if (ctx.dirty) {
            logDebug('Dropping render. State changed during render.');
            return renderComponent(rctx, ctx);
          }

          let componentCtx = ctx.component;
          if (!componentCtx) {
            componentCtx = ctx.component = {
              hostElement,
              slots: [],
              styleHostClass: undefined,
              styleClass: undefined,
              styleId: undefined,
            };
            const scopedStyleId = hostElement.getAttribute(ComponentScopedStyles) ?? undefined;
            if (scopedStyleId) {
              componentCtx.styleId = scopedStyleId;
              componentCtx.styleHostClass = styleHost(scopedStyleId);
              componentCtx.styleClass = styleContent(scopedStyleId);
              hostElement.classList.add(componentCtx.styleHostClass);
            }
          }
          componentCtx.slots = [];
          newCtx.components.push(componentCtx);
          return visitJsxNode(newCtx, hostElement, processNode(jsxNode), false);
        });
      },
      (err) => {
        logError(err);
      }
    );
  } catch (err) {
    logError(err);
  }
};
