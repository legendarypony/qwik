import {
  component$,
  jsx,
  type JSXNode,
  SkipRender,
  useContext,
  _IMMUTABLE,
  _jsxBranch,
  _jsxQ,
} from '@builder.io/qwik';

import { ContentInternalContext } from './contexts';
import popStateScript from './init-popstate.txt?raw';

/**
 * @public
 */
export const RouterOutlet = component$(() => {
  _jsxBranch();

  const { value } = useContext(ContentInternalContext);
  if (value && value.length > 0) {
    const contentsLen = value.length;
    let cmp: JSXNode | null = null;
    for (let i = contentsLen - 1; i >= 0; i--) {
      cmp = jsx(value[i].default, {
        children: cmp,
      });
    }
    return (
      <>
        {cmp}
        <script dangerouslySetInnerHTML={popStateScript}></script>
      </>
    );
  }
  return SkipRender;
});
