/**
 * @license
 * Copyright a-Qoot All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://github.com/a-Qoot/qoot/blob/main/LICENSE
 */

import { inject, markDirty } from '../../qoot.js';
import { ItemService } from '../Item/public.js';
import { ItemsService } from './public.js';

export default inject(
  ItemsService, //
  function newItem(this: ItemsService, newTitle: string): Promise<ItemService> {
    const itemService = ItemService.$hydrate(
      this.$injector.element,
      { id: String(this.$state.nextId++) },
      { completed: false, title: newTitle }
    );
    this.$state.items.push(itemService.$key);
    markDirty(this);
    return itemService;
  }
);
