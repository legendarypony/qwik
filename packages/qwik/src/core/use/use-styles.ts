import { styleKey } from '../component/qrl-styles';
import type { QRL } from '../import/qrl.public';
import { useSequentialScope } from './use-store.public';
import { implicit$FirstArg } from '../util/implicit_dollar';
import { getContext } from '../props/props';
import { hasStyle } from '../render/execute-component';

// <docs markdown="../readme.md#useStyles">
// !!DO NOT EDIT THIS COMMENT DIRECTLY!!!
// (edit ../readme.md#useStyles instead)
/**
 * A lazy-loadable reference to a component's styles.
 *
 * Component styles allow Qwik to lazy load the style information for the component only when
 * needed. (And avoid double loading it in case of SSR hydration.)
 *
 * ```tsx
 * import styles from './code-block.css?inline';
 *
 * export const CmpStyles = component$(() => {
 *   useStyles$(styles);
 *
 *   return <Host>Some text</Host>;
 * });
 * ```
 * *
 * @public
 */
// </docs>
export const useStylesQrl = (styles: QRL<string>): void => {
  _useStyles(styles, false);
};

// <docs markdown="../readme.md#useStyles">
// !!DO NOT EDIT THIS COMMENT DIRECTLY!!!
// (edit ../readme.md#useStyles instead)
/**
 * A lazy-loadable reference to a component's styles.
 *
 * Component styles allow Qwik to lazy load the style information for the component only when
 * needed. (And avoid double loading it in case of SSR hydration.)
 *
 * ```tsx
 * import styles from './code-block.css?inline';
 *
 * export const CmpStyles = component$(() => {
 *   useStyles$(styles);
 *
 *   return <Host>Some text</Host>;
 * });
 * ```
 *
 * *
 * @public
 */
// </docs>
export const useStyles$ = /*#__PURE__*/ implicit$FirstArg(useStylesQrl);

// <docs markdown="../readme.md#useScopedStyles">
// !!DO NOT EDIT THIS COMMENT DIRECTLY!!!
// (edit ../readme.md#useScopedStyles instead)
/**
 * @see `useStyles`.
 *
 * @alpha
 */
// </docs>
export const useScopedStylesQrl = (styles: QRL<string>): void => {
  _useStyles(styles, true);
};

// <docs markdown="../readme.md#useScopedStyles">
// !!DO NOT EDIT THIS COMMENT DIRECTLY!!!
// (edit ../readme.md#useScopedStyles instead)
/**
 * @see `useStyles`.
 *
 * @alpha
 */
// </docs>
export const useScopedStyles$ = /*#__PURE__*/ implicit$FirstArg(useScopedStylesQrl);

const _useStyles = (styleQrl: QRL<string>, scoped: boolean) => {
  const { get, set, ctx, i } = useSequentialScope<boolean>();
  if (get === true) {
    return;
  }
  set(true);
  const renderCtx = ctx.$renderCtx$;
  const styleId = styleKey(styleQrl, i);
  const hostElement = ctx.$hostElement$;
  const containerState = renderCtx.$containerState$;
  const elCtx = getContext(ctx.$hostElement$);
  if (!hasStyle(containerState, styleId)) {
    containerState.$stylesIds$.add(styleId);
    ctx.$waitOn$.push(
      styleQrl.resolve(hostElement).then((styleText) => {
        elCtx.$styles$.push({
          type: 'style',
          styleId,
          content: scoped ? styleText.replace(/�/g, styleId) : styleText,
        });
      })
    );
  }
};
