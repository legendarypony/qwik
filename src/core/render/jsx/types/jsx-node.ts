/**
 * @public
 */
export type ComponentChild =
  | JSXNode<any>
  | object
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined;

/**
 * @public
 */
export type ComponentChildren = ComponentChild[] | ComponentChild;

/**
 * @public
 */
export type RenderableProps<
  P,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  RefType = any
> = P & Readonly<{ children?: ComponentChildren }>;

/**
 * @public
 */
export interface FunctionComponent<P = {}> {
  (props: P): JSXNode | null;
}

/**
 * @public
 */
export interface JSXNode<T = any> {
  type: T;
  props: any;
  children: ComponentChild[];
  key: string | number | any;
}

/**
 * @public
 */
export type JSXFactory<T, PROPS extends {} = any> = (props: PROPS, state?: any) => JSXNode<T>;
