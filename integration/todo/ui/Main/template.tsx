/**
 * @license
 * Copyright a-Qoot All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://github.com/a-Qoot/qoot/blob/main/LICENSE
 */

import type { TodoService } from '../../data/Todo/public.js';
import { injectFunction, jsxFactory, provideComponentProp, provideService } from '../../qoot.js';
import { Item } from '../Item/public.js';

export const _needed_by_JSX_ = jsxFactory; // eslint-disable-line @typescript-eslint/no-unused-vars
export default injectFunction(
  provideService<TodoService>(provideComponentProp('$items')), //
  function (todoService: TodoService) {
    const itemKeys = todoService.filteredItems;
    return (
      <section class="main" /* *ngIf="todoStore.todos.length > 0 " */>
        <input
          id="toggle-all"
          class="toggle-all"
          type="checkbox"
          /* *ngIf="todoStore.todos.length" #toggleall 
             [checked]="todoStore.allCompleted()" 
             (click)="todoStore.setAllTo(toggleall.checked)" */
        />
        <ul class="todo-list">
          {itemKeys.map((key) => (
            <Item $item={key} />
          ))}
        </ul>
      </section>
    );
  }
);

/* // TODO: Create QFor and QIf directive?
  <Q for="todos.value" do={(todo) => <Item $item={todo} />} />
  <Q if="todos.value.length > 0" then={(value) => <section></section>} />
*/
