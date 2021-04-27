/**
 * @license
 * Copyright a-Qoot All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://github.com/a-Qoot/qoot/blob/main/LICENSE
 */

import { jsxFactory, QRL, injectMethod } from '../../qoot.js';
import { HeaderComponent } from './component.js';

export const _needed_by_JSX_ = jsxFactory; // eslint-disable-line @typescript-eslint/no-unused-vars
export default injectMethod(
  HeaderComponent, //
  function (this: HeaderComponent) {
    return (
      <>
        <h1>todos</h1>
        <input
          class="new-todo"
          placeholder="What needs to be done?"
          autofocus
          value={this.$state.text}
          on:keyup= {QRL`ui:/Header/addTodo?value=.target.value&code=.code`}
        />
      </>
    );
  }
);
