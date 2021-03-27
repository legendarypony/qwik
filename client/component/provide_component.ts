/**
 * @license
 * Copyright a-Qoot All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://github.com/a-Qoot/qoot/blob/main/LICENSE
 */
import { Provider, Injector } from '../injection/types.js';
import { Component } from './component.js';
import { ComponentType } from './types.js';

/**
 * Provider of Component.
 *
 * Use this function in conjunction with `inject` to inject Component into the
 * `InjectedFunction`.
 *
 * Components are transient (meaning they are not serialized from the server.)
 * For this reason this function will lazy create component if needed.
 *
 * Component is store at the nearest [host-element](./HOST_ELEMENT.md). A host-element
 * is demarcated with the `::` attribute pointing to the render import. The component
 * instance is patched onto the host-element so that it does not have to be created
 * next time.
 *
 * See:
 * - STATE.md
 * - `inject`
 * - `Component`
 * - `Component.$inject`
 *
 * Example:
 * ```
 * export default inject(
 *   null,
 *   provideComponent(MyComponent)
 *   function (myComponent: MyComponent) {
 *     ...
 *   }
 * );
 * ```
 *
 * @param componentType
 */
export function provideComponent<COMP extends Component<any, any>>(
  componentType: ComponentType<COMP>
): Provider<COMP> {
  return function componentProvider(injector: Injector): COMP | Promise<COMP> {
    return null!;
    // const elementInjector = ensureElementInjector(injector);
    // const hostElement = getComponentHost(injector.element);
    // const storage = getInjector(hostElement);
    // let componentInjector = storage.get('') as ElementInjector | null;
    // if (componentInjector == null) {
    //   componentInjector = createComponentInjector(hostElement, null);
    //   const component = componentType.newInject(componentInjector) as C;
    //   if (componentInjector.componentInstance === null) {
    //     componentInjector.componentInstance = component;
    //   }
    //   qDev && assertEqual(componentInjector.componentInstance, component);
    //   storage.set(':.', componentInjector as any);
    // }
    // return componentInjector.componentInstance as C;
  };
}
