/**
 * @license
 * Copyright Builder.io, Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://github.com/BuilderIO/qwik/blob/main/LICENSE
 */

import { NodeType } from './types';

export function isNode(value: any): value is Node {
  return value && typeof value.nodeType == 'number';
}
export function isDocument(value: any): value is Document {
  return value && value.nodeType == NodeType.DOCUMENT_NODE;
}
export function isElement(value: any): value is HTMLElement {
  return isNode(value) && value.nodeType == NodeType.ELEMENT_NODE;
}
export function isText(value: any): value is Text {
  return isNode(value) && value.nodeType == NodeType.TEXT_NODE;
}
export function isComment(value: any): value is Comment {
  return isNode(value) && value.nodeType == NodeType.COMMENT_NODE;
}
