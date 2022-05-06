use crate::code_move::fix_path;
use crate::collector::{
    collect_from_pat, new_ident_from_id, GlobalCollect, Id, IdentCollector, ImportKind,
};
use crate::entry_strategy::EntryPolicy;
use crate::parse::PathData;
use crate::words::*;
use path_slash::PathExt;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::hash::Hash;
use std::hash::Hasher;

use swc_atoms::JsWord;
use swc_common::comments::{Comments, SingleThreadedComments};
use swc_common::{errors::HANDLER, Mark, Spanned, DUMMY_SP};
use swc_ecmascript::ast;
use swc_ecmascript::utils::{private_ident, ExprFactory};
use swc_ecmascript::visit::{fold_expr, noop_fold_type, Fold, FoldWith, VisitWith};

macro_rules! id {
    ($ident: expr) => {
        ($ident.sym.clone(), $ident.span.ctxt())
    };
}

macro_rules! id_eq {
    ($ident: expr, $cid: expr) => {
        if let Some(cid) = $cid {
            cid.0 == $ident.sym && cid.1 == $ident.span.ctxt()
        } else {
            false
        }
    };
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HookKind {
    Function,
    Event,
}

#[derive(Debug, Clone)]
pub struct Hook {
    pub entry: Option<JsWord>,
    pub canonical_filename: JsWord,
    pub name: JsWord,
    pub expr: Box<ast::Expr>,
    pub data: HookData,
    pub hash: u64,
}

#[derive(Debug, Clone)]
pub struct HookData {
    pub extension: JsWord,
    pub local_idents: Vec<Id>,
    pub scoped_idents: Vec<Id>,
    pub parent_hook: Option<JsWord>,
    pub ctx_kind: HookKind,
    pub ctx_name: JsWord,
    pub origin: JsWord,
    pub display_name: JsWord,
    pub hash: JsWord,
}

#[derive(Debug)]
enum PositionToken {
    JSXFunction,
    Any,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum IdentType {
    Var,
    Fn,
    Class,
}

pub type IdPlusType = (Id, IdentType);

#[allow(clippy::module_name_repetitions)]
pub struct QwikTransform<'a> {
    pub hooks: Vec<Hook>,
    pub qwik_ident: Id,
    pub options: QwikTransformOptions<'a>,

    hooks_names: HashMap<String, u32>,
    extra_module_items: BTreeMap<Id, ast::ModuleItem>,
    stack_ctxt: Vec<String>,
    position_ctxt: Vec<PositionToken>,
    decl_stack: Vec<Vec<IdPlusType>>,
    in_component: bool,
    marker_functions: HashMap<Id, JsWord>,
    jsx_functions: HashSet<Id>,
    qcomponent_fn: Option<Id>,
    qhook_fn: Option<Id>,
    h_fn: Option<Id>,
    fragment_fn: Option<Id>,

    hook_stack: Vec<JsWord>,
}

pub struct QwikTransformOptions<'a> {
    pub path_data: &'a PathData,
    pub entry_policy: &'a dyn EntryPolicy,
    pub extension: JsWord,
    pub explicity_extensions: bool,
    pub comments: Option<&'a SingleThreadedComments>,
    pub global_collect: GlobalCollect,
    pub dev: bool,
}

fn convert_signal_word(id: &JsWord) -> Option<JsWord> {
    let ident_name = id.as_ref();
    let has_signal = ident_name.ends_with(SIGNAL);
    if has_signal {
        let new_specifier = [&ident_name[0..ident_name.len() - 1], LONG_SUFFIX].concat();
        Some(JsWord::from(new_specifier))
    } else {
        None
    }
}

impl<'a> QwikTransform<'a> {
    pub fn new(options: QwikTransformOptions<'a>) -> Self {
        let mut marker_functions = HashMap::new();
        for (id, import) in options.global_collect.imports.iter() {
            if import.kind == ImportKind::Named && import.specifier.ends_with(SIGNAL) {
                marker_functions.insert(id.clone(), import.specifier.clone());
            }
        }

        for id in options.global_collect.exports.keys() {
            if id.0.ends_with(SIGNAL) {
                marker_functions.insert(id.clone(), id.0.clone());
            }
        }

        let jsx_functions = options
            .global_collect
            .imports
            .iter()
            .flat_map(|(id, import)| {
                if import.kind == ImportKind::Named && import.source == *BUILDER_IO_QWIK_JSX {
                    Some(id.clone())
                } else {
                    None
                }
            })
            .collect();

        QwikTransform {
            stack_ctxt: Vec::with_capacity(16),
            position_ctxt: Vec::with_capacity(32),
            decl_stack: Vec::with_capacity(32),
            in_component: false,
            hooks: Vec::with_capacity(16),
            hook_stack: Vec::with_capacity(16),
            extra_module_items: BTreeMap::new(),
            hooks_names: HashMap::new(),
            qcomponent_fn: options
                .global_collect
                .get_imported_local(&QCOMPONENT, &BUILDER_IO_QWIK),
            qhook_fn: options
                .global_collect
                .get_imported_local(&QHOOK, &BUILDER_IO_QWIK),
            h_fn: options
                .global_collect
                .get_imported_local(&H, &BUILDER_IO_QWIK),
            fragment_fn: options
                .global_collect
                .get_imported_local(&FRAGMENT, &BUILDER_IO_QWIK),
            marker_functions,
            jsx_functions,
            qwik_ident: id!(private_ident!(QWIK_INTERNAL.clone())),
            options,
        }
    }

    fn register_context_name(&mut self) -> (JsWord, JsWord, JsWord, u64) {
        let mut display_name = self.stack_ctxt.join("_");
        if self.stack_ctxt.is_empty() {
            display_name += "s_";
        }
        display_name = escape_sym(&display_name);
        let index = match self.hooks_names.get_mut(&display_name) {
            Some(count) => {
                *count += 1;
                *count
            }
            None => 0,
        };
        if index == 0 {
            self.hooks_names.insert(display_name.clone(), 0);
        } else {
            display_name += &format!("_{}", index);
        }
        let mut hasher = DefaultHasher::new();
        let local_file_name = self.options.path_data.path.to_slash_lossy();

        hasher.write(local_file_name.as_bytes());
        hasher.write(display_name.as_bytes());
        let hash = hasher.finish();
        let hash64 = base64(hash);

        let symbol_name = if self.options.dev {
            format!("{}_{}", display_name, hash64)
        } else {
            format!("s_{}", hash64)
        };
        (
            JsWord::from(symbol_name),
            JsWord::from(display_name),
            JsWord::from(hash64),
            hash,
        )
    }

    fn handle_qhook(&mut self, node: ast::CallExpr) -> ast::CallExpr {
        let mut node = node;
        node.args.reverse();

        if let Some(ast::ExprOrSpread {
            expr: first_arg, ..
        }) = node.args.pop()
        {
            self.create_synthetic_qhook(*first_arg, HookKind::Function, QHOOK.clone())
        } else {
            node
        }
    }

    fn create_synthetic_qhook(
        &mut self,
        first_arg: ast::Expr,
        ctx_kind: HookKind,
        ctx_name: JsWord,
    ) -> ast::CallExpr {
        let can_capture = can_capture_scope(&first_arg);
        let first_arg_span = first_arg.span();

        let (symbol_name, display_name, hash, hook_hash) = self.register_context_name();
        let canonical_filename = JsWord::from(symbol_name.as_ref().to_ascii_lowercase());

        // Collect descendent idents
        let descendent_idents = {
            let mut collector = IdentCollector::new();
            first_arg.visit_with(&mut collector);
            collector.get_words()
        };

        let (valid_decl, invalid_decl): (_, Vec<_>) = self
            .decl_stack
            .iter()
            .flat_map(|v| v.iter())
            .cloned()
            .partition(|(_, t)| t == &IdentType::Var);

        let decl_collect: HashSet<Id> = valid_decl.into_iter().map(|a| a.0).collect();
        let invalid_decl: HashSet<Id> = invalid_decl.into_iter().map(|a| a.0).collect();

        self.hook_stack.push(symbol_name.clone());
        let folded = fold_expr(self, first_arg);
        self.hook_stack.pop();

        // Collect local idents
        let local_idents = {
            let mut collector = IdentCollector::new();
            folded.visit_with(&mut collector);

            let use_h = collector.use_h;
            let use_fragment = collector.use_fragment;

            let mut idents = collector.get_words();
            if use_h {
                if let Some(id) = &self.h_fn {
                    idents.push(id.clone());
                }
            }
            if use_fragment {
                if let Some(id) = &self.fragment_fn {
                    idents.push(id.clone());
                }
            }
            idents
        };

        for id in &local_idents {
            if !self.options.global_collect.exports.contains_key(id) {
                if let Some(span) = self.options.global_collect.root.get(id) {
                    HANDLER.with(|handler| {
                        handler
                            .struct_span_err(
                                *span,
                                &format!(
                                    "Reference to root level identifier needs to be exported: {}",
                                    id.0
                                ),
                            )
                            .emit();
                    });
                }
                if invalid_decl.contains(id) {
                    HANDLER.with(|handler| {
                        handler
                            .struct_err(&format!(
                                "Identifier can not capture because it's a function: {}",
                                id.0
                            ))
                            .emit();
                    });
                }
            }
        }

        let mut scoped_idents = compute_scoped_idents(&descendent_idents, &decl_collect);
        if !can_capture && !scoped_idents.is_empty() {
            HANDLER.with(|handler| {
                handler
                    .struct_span_err(first_arg_span, "Identifier can not be captured")
                    .emit();
            });
            scoped_idents = vec![];
        }

        let hook_data = HookData {
            extension: self.options.extension.clone(),
            local_idents,
            scoped_idents: scoped_idents.clone(),
            parent_hook: self.hook_stack.last().cloned(),
            ctx_kind,
            ctx_name,
            origin: self.options.path_data.path.to_slash_lossy().into(),
            display_name,
            hash,
        };

        let entry = self.options.entry_policy.get_entry_for_sym(
            &symbol_name,
            self.options.path_data,
            &self.stack_ctxt,
            &hook_data,
        );

        let mut filename = format!(
            "./{}",
            entry
                .as_ref()
                .map(|e| e.as_ref())
                .unwrap_or(&canonical_filename)
        );
        if self.options.explicity_extensions {
            filename.push('.');
            filename.push_str(&self.options.extension);
        }
        let import_path = if !self.hook_stack.is_empty() {
            fix_path("a", "a", &filename).unwrap()
        } else {
            fix_path("a", &self.options.path_data.path, &filename).unwrap()
        };

        let o = create_inline_qrl(&self.qwik_ident, import_path, &symbol_name, &scoped_idents);
        self.hooks.push(Hook {
            entry,
            canonical_filename,
            name: symbol_name,
            data: hook_data,
            expr: Box::new(folded),
            hash: hook_hash,
        });
        o
    }

    fn handle_jsx(&mut self, node: ast::CallExpr) -> ast::CallExpr {
        let mut name_token = false;
        let first_arg = node.args.get(0);
        if let Some(name) = first_arg {
            match &*name.expr {
                ast::Expr::Lit(ast::Lit::Str(str)) => {
                    self.stack_ctxt.push(str.value.to_string());
                    name_token = true;
                }
                ast::Expr::Ident(ident) => {
                    self.stack_ctxt.push(ident.sym.to_string());
                    name_token = true;
                }
                _ => {}
            }
        }
        self.position_ctxt.push(PositionToken::JSXFunction);
        let o = node.fold_children_with(self);
        self.position_ctxt.pop();
        if name_token {
            self.stack_ctxt.pop();
        }

        o
    }

    fn handle_jsx_value(
        &mut self,
        ctx_name: JsWord,
        value: Option<ast::JSXAttrValue>,
    ) -> Option<ast::JSXAttrValue> {
        if let Some(ast::JSXAttrValue::JSXExprContainer(container)) = value {
            if let ast::JSXExpr::Expr(expr) = container.expr {
                Some(ast::JSXAttrValue::JSXExprContainer(ast::JSXExprContainer {
                    span: DUMMY_SP,
                    expr: ast::JSXExpr::Expr(Box::new(ast::Expr::Call(
                        self.create_synthetic_qhook(*expr, HookKind::Event, ctx_name),
                    ))),
                }))
            } else {
                Some(ast::JSXAttrValue::JSXExprContainer(container))
            }
        } else {
            value
        }
    }
}

impl<'a> Fold for QwikTransform<'a> {
    noop_fold_type!();

    fn fold_module(&mut self, node: ast::Module) -> ast::Module {
        let mut body = Vec::with_capacity(node.body.len() + 10);
        body.push(create_synthetic_wildcard_import(
            &self.qwik_ident,
            &BUILDER_IO_QWIK,
        ));

        let mut module_body = node.body.into_iter().map(|i| i.fold_with(self)).collect();
        body.extend(self.extra_module_items.values().cloned());
        body.append(&mut module_body);

        ast::Module { body, ..node }
    }

    // Variable tracking
    fn fold_var_declarator(&mut self, node: ast::VarDeclarator) -> ast::VarDeclarator {
        let mut stacked = false;
        if let ast::Pat::Ident(ref ident) = node.name {
            self.stack_ctxt.push(ident.id.sym.to_string());
            stacked = true;
        }
        if let Some(current_scope) = self.decl_stack.last_mut() {
            let mut identifiers = vec![];
            collect_from_pat(&node.name, &mut identifiers);
            current_scope.extend(identifiers.into_iter().map(|(id, _)| (id, IdentType::Var)));
        }
        let o = node.fold_children_with(self);
        if stacked {
            self.stack_ctxt.pop();
        }
        o
    }

    fn fold_fn_decl(&mut self, node: ast::FnDecl) -> ast::FnDecl {
        if let Some(current_scope) = self.decl_stack.last_mut() {
            current_scope.push((id!(node.ident), IdentType::Fn));
        }
        self.stack_ctxt.push(node.ident.sym.to_string());
        self.decl_stack.push(vec![]);

        let mut identifiers = vec![];
        for param in &node.function.params {
            collect_from_pat(&param.pat, &mut identifiers);
        }
        self.decl_stack
            .last_mut()
            .expect("Declaration stack empty!")
            .extend(
                identifiers
                    .into_iter()
                    .map(|(key, _)| (key, IdentType::Var)),
            );

        let o = node.fold_children_with(self);
        self.stack_ctxt.pop();
        self.decl_stack.pop();

        o
    }

    fn fold_arrow_expr(&mut self, node: ast::ArrowExpr) -> ast::ArrowExpr {
        self.decl_stack.push(vec![]);
        let current_scope = self
            .decl_stack
            .last_mut()
            .expect("Declaration stack empty!");

        for param in &node.params {
            let mut identifiers = vec![];
            collect_from_pat(param, &mut identifiers);
            current_scope.extend(identifiers.into_iter().map(|(id, _)| (id, IdentType::Var)));
        }

        let o = node.fold_children_with(self);
        self.decl_stack.pop();

        o
    }

    fn fold_for_stmt(&mut self, node: ast::ForStmt) -> ast::ForStmt {
        self.decl_stack.push(vec![]);
        let o = node.fold_children_with(self);
        self.decl_stack.pop();

        o
    }

    fn fold_for_in_stmt(&mut self, node: ast::ForInStmt) -> ast::ForInStmt {
        self.decl_stack.push(vec![]);
        let o = node.fold_children_with(self);
        self.decl_stack.pop();

        o
    }

    fn fold_for_of_stmt(&mut self, node: ast::ForOfStmt) -> ast::ForOfStmt {
        self.decl_stack.push(vec![]);
        let o = node.fold_children_with(self);
        self.decl_stack.pop();

        o
    }

    fn fold_if_stmt(&mut self, node: ast::IfStmt) -> ast::IfStmt {
        self.decl_stack.push(vec![]);
        let o = node.fold_children_with(self);
        self.decl_stack.pop();

        o
    }

    fn fold_block_stmt(&mut self, node: ast::BlockStmt) -> ast::BlockStmt {
        self.decl_stack.push(vec![]);
        let o = node.fold_children_with(self);
        self.decl_stack.pop();

        o
    }

    fn fold_while_stmt(&mut self, node: ast::WhileStmt) -> ast::WhileStmt {
        self.decl_stack.push(vec![]);
        let o = node.fold_children_with(self);
        self.decl_stack.pop();

        o
    }

    fn fold_class_decl(&mut self, node: ast::ClassDecl) -> ast::ClassDecl {
        if let Some(current_scope) = self.decl_stack.last_mut() {
            current_scope.push((id!(node.ident), IdentType::Class));
        }

        self.stack_ctxt.push(node.ident.sym.to_string());
        self.decl_stack.push(vec![]);
        let o = node.fold_children_with(self);
        self.stack_ctxt.pop();
        self.decl_stack.pop();

        o
    }

    fn fold_jsx_element(&mut self, node: ast::JSXElement) -> ast::JSXElement {
        let mut stacked = false;

        if let ast::JSXElementName::Ident(ref ident) = node.opening.name {
            self.stack_ctxt.push(ident.sym.to_string());
            stacked = true;
        }
        let o = node.fold_children_with(self);
        if stacked {
            self.stack_ctxt.pop();
        }
        o
    }

    fn fold_jsx_attr(&mut self, node: ast::JSXAttr) -> ast::JSXAttr {
        let mut is_listener = false;
        let node = match node.name {
            ast::JSXAttrName::Ident(ref ident) => {
                let new_word = convert_signal_word(&ident.sym);
                self.stack_ctxt.push(ident.sym.to_string());
                if let Some(new_word) = new_word {
                    is_listener = true;
                    ast::JSXAttr {
                        name: ast::JSXAttrName::Ident(ast::Ident::new(new_word, DUMMY_SP)),
                        value: self.handle_jsx_value(ident.sym.clone(), node.value),
                        span: DUMMY_SP,
                    }
                } else {
                    node
                }
            }
            ast::JSXAttrName::JSXNamespacedName(ref namespaced) => {
                let new_word = convert_signal_word(&namespaced.name.sym);
                let ident_name = [
                    namespaced.ns.sym.as_ref(),
                    "-",
                    namespaced.name.sym.as_ref(),
                ]
                .concat();
                self.stack_ctxt.push(ident_name.clone());
                if let Some(new_word) = new_word {
                    is_listener = true;
                    ast::JSXAttr {
                        name: ast::JSXAttrName::JSXNamespacedName(ast::JSXNamespacedName {
                            ns: namespaced.ns.clone(),
                            name: ast::Ident::new(new_word, DUMMY_SP),
                        }),
                        value: self.handle_jsx_value(JsWord::from(ident_name), node.value),
                        span: DUMMY_SP,
                    }
                } else {
                    node
                }
            }
        };

        let o = node.fold_children_with(self);
        self.stack_ctxt.pop();
        if is_listener {
            self.position_ctxt.pop();
        }
        o
    }

    fn fold_key_value_prop(&mut self, node: ast::KeyValueProp) -> ast::KeyValueProp {
        let jsx_call = matches!(self.position_ctxt.last(), Some(PositionToken::JSXFunction));

        let mut name_token = false;

        let node = match node.key {
            ast::PropName::Ident(ref ident) => {
                if ident.sym != *CHILDREN {
                    self.stack_ctxt.push(ident.sym.to_string());
                    name_token = true;
                }
                if jsx_call {
                    if let Some(new_word) = convert_signal_word(&ident.sym) {
                        ast::KeyValueProp {
                            key: ast::PropName::Ident(ast::Ident::new(new_word, DUMMY_SP)),
                            value: Box::new(ast::Expr::Call(self.create_synthetic_qhook(
                                *node.value,
                                HookKind::Event,
                                ident.sym.clone(),
                            ))),
                        }
                    } else {
                        node
                    }
                } else {
                    node
                }
            }
            ast::PropName::Str(ref s) => {
                if s.value != *CHILDREN {
                    self.stack_ctxt.push(s.value.to_string());
                    name_token = true;
                }
                if jsx_call {
                    if let Some(new_word) = convert_signal_word(&s.value) {
                        ast::KeyValueProp {
                            key: ast::PropName::Str(ast::Str::from(new_word)),
                            value: Box::new(ast::Expr::Call(self.create_synthetic_qhook(
                                *node.value,
                                HookKind::Event,
                                s.value.clone(),
                            ))),
                        }
                    } else {
                        node
                    }
                } else {
                    node
                }
            }
            _ => node,
        };

        self.position_ctxt.push(PositionToken::Any);
        let o = node.fold_children_with(self);
        self.position_ctxt.pop();
        if name_token {
            self.stack_ctxt.pop();
        }
        o
    }

    fn fold_call_expr(&mut self, node: ast::CallExpr) -> ast::CallExpr {
        let mut name_token = false;
        let mut component_token = false;
        let mut replace_callee = None;
        let mut ctx_name: JsWord = QHOOK.clone();

        if let ast::Callee::Expr(expr) = &node.callee {
            if let ast::Expr::Ident(ident) = &**expr {
                if id_eq!(ident, &self.qhook_fn) {
                    if let Some(comments) = self.options.comments {
                        comments.add_pure_comment(ident.span.lo);
                    }
                    return self.handle_qhook(node);
                } else if self.jsx_functions.contains(&id!(ident)) {
                    return self.handle_jsx(node);
                } else if let Some(specifier) = self.marker_functions.get(&id!(ident)) {
                    self.stack_ctxt.push(ident.sym.to_string());
                    ctx_name = specifier.clone();
                    name_token = true;

                    if id_eq!(ident, &self.qcomponent_fn) {
                        self.in_component = true;
                        component_token = true;
                        if let Some(comments) = self.options.comments {
                            comments.add_pure_comment(node.span.lo);
                        }
                    }
                    let global_collect = &mut self.options.global_collect;
                    if let Some(import) = global_collect.imports.get(&id!(ident)).cloned() {
                        let new_specifier =
                            convert_signal_word(&import.specifier).expect("Specifier ends with $");
                        let new_local = global_collect.import(new_specifier, import.source.clone());

                        let is_synthetic =
                            global_collect.imports.get(&new_local).unwrap().synthetic;

                        if is_synthetic && self.hook_stack.is_empty() {
                            self.extra_module_items.insert(
                                new_local.clone(),
                                create_synthetic_named_import(&new_local, &import.source),
                            );
                        }
                        replace_callee = Some(new_ident_from_id(&new_local).as_callee());
                    } else {
                        let new_specifier =
                            convert_signal_word(&ident.sym).expect("Specifier ends with $");
                        let new_local = global_collect
                            .exports
                            .keys()
                            .find(|id| id.0 == new_specifier);

                        new_local.map_or_else(
                            || {
                                HANDLER.with(|handler| {
                                    handler
                                        .struct_span_err(
                                            ident.span,
                                            "Version without $ is not exported.",
                                        )
                                        .emit();
                                });
                            },
                            |new_local| {
                                replace_callee = Some(new_ident_from_id(new_local).as_callee());
                            },
                        );
                    }
                }
            }
        }

        let convert_qrl = replace_callee.is_some();
        let callee = if let Some(callee) = replace_callee {
            callee
        } else {
            node.callee
        };
        let callee = callee.fold_with(self);
        let args: Vec<ast::ExprOrSpread> = node
            .args
            .into_iter()
            .enumerate()
            .map(|(i, arg)| {
                if convert_qrl && i == 0 {
                    ast::ExprOrSpread {
                        expr: Box::new(ast::Expr::Call(self.create_synthetic_qhook(
                            *arg.expr,
                            HookKind::Function,
                            ctx_name.clone(),
                        )))
                        .fold_with(self),
                        ..arg
                    }
                } else {
                    arg.fold_with(self)
                }
            })
            .collect();

        if name_token {
            self.stack_ctxt.pop();
        }
        if component_token {
            self.in_component = false;
        }
        ast::CallExpr {
            callee,
            args,
            ..node
        }
    }
}

pub fn add_handle_watch(body: &mut Vec<ast::ModuleItem>, private: bool) {
    let ident = if private {
        private_ident!(JsWord::from("hW"))
    } else {
        ast::Ident::new(JsWord::from("hW"), DUMMY_SP)
    };
    let import = create_synthetic_named_import_auto(&id!(ident), &HANDLE_WATCH, &BUILDER_IO_QWIK);
    body.push(import);
    body.push(ast::ModuleItem::Stmt(ast::Stmt::Expr(ast::ExprStmt {
        span: DUMMY_SP,
        expr: Box::new(ast::Expr::Bin(ast::BinExpr {
            span: DUMMY_SP,
            op: ast::BinaryOp::LogicalAnd,
            left: Box::new(ast::Expr::Member(ast::MemberExpr {
                obj: Box::new(ast::Expr::Ident(ident.clone())),
                prop: ast::MemberProp::Ident(ast::Ident::new(JsWord::from("issue456"), DUMMY_SP)),
                span: DUMMY_SP,
            })),
            right: Box::new(ast::Expr::Call(ast::CallExpr {
                callee: ast::Callee::Expr(Box::new(ast::Expr::Member(ast::MemberExpr {
                    obj: Box::new(ast::Expr::Ident(ident.clone())),
                    prop: ast::MemberProp::Ident(ast::Ident::new(
                        JsWord::from("issue123"),
                        DUMMY_SP,
                    )),
                    span: DUMMY_SP,
                }))),
                args: vec![],
                span: DUMMY_SP,
                type_args: None,
            })),
        })),
    })));
    body.push(ast::ModuleItem::ModuleDecl(ast::ModuleDecl::ExportNamed(
        ast::NamedExport {
            src: None,
            span: DUMMY_SP,
            asserts: None,
            type_only: false,
            specifiers: vec![ast::ExportSpecifier::Named(ast::ExportNamedSpecifier {
                orig: ast::ModuleExportName::Ident(ident),
                exported: Some(ast::ModuleExportName::Ident(ast::Ident::new(
                    HANDLE_WATCH.clone(),
                    DUMMY_SP,
                ))),
                is_type_only: false,
                span: DUMMY_SP,
            })],
        },
    )));
    // Uncommented when issue 456 is fixed
    // body.push(create_synthetic_named_export(
    //     &HANDLE_WATCH,
    //     &BUILDER_IO_QWIK,
    // ));
}

pub fn create_synthetic_wildcard_import(local: &Id, src: &JsWord) -> ast::ModuleItem {
    ast::ModuleItem::ModuleDecl(ast::ModuleDecl::Import(ast::ImportDecl {
        span: DUMMY_SP,
        src: ast::Str {
            span: DUMMY_SP,
            has_escape: false,
            value: src.clone(),
            kind: ast::StrKind::Normal {
                contains_quote: false,
            },
        },
        asserts: None,
        type_only: false,
        specifiers: vec![ast::ImportSpecifier::Namespace(
            ast::ImportStarAsSpecifier {
                local: new_ident_from_id(local),
                span: DUMMY_SP,
            },
        )],
    }))
}

pub fn create_synthetic_named_import_auto(
    local: &Id,
    specifier: &JsWord,
    src: &JsWord,
) -> ast::ModuleItem {
    ast::ModuleItem::ModuleDecl(ast::ModuleDecl::Import(ast::ImportDecl {
        span: DUMMY_SP,
        src: ast::Str {
            span: DUMMY_SP,
            has_escape: false,
            value: src.clone(),
            kind: ast::StrKind::Normal {
                contains_quote: false,
            },
        },
        asserts: None,
        type_only: false,
        specifiers: vec![ast::ImportSpecifier::Named(ast::ImportNamedSpecifier {
            local: new_ident_from_id(local),
            is_type_only: false,
            imported: Some(ast::ModuleExportName::Ident(ast::Ident::new(
                specifier.clone(),
                DUMMY_SP,
            ))),
            span: DUMMY_SP,
        })],
    }))
}

// pub fn create_synthetic_named_export(local: &JsWord, src: &JsWord) -> ast::ModuleItem {
//     ast::ModuleItem::ModuleDecl(ast::ModuleDecl::ExportNamed(ast::NamedExport {
//         span: DUMMY_SP,
//         asserts: None,
//         type_only: false,
//         src: Some(ast::Str {
//             span: DUMMY_SP,
//             has_escape: false,
//             value: src.clone(),
//             kind: ast::StrKind::Normal {
//                 contains_quote: false,
//             },
//         }),
//         specifiers: vec![ast::ExportSpecifier::Named(ast::ExportNamedSpecifier {
//             is_type_only: false,
//             exported: None,
//             orig: ast::ModuleExportName::Ident(ast::Ident::new(local.clone(), DUMMY_SP)),
//             span: DUMMY_SP,
//         })],
//     }))
// }

fn create_synthetic_named_import(local: &Id, src: &JsWord) -> ast::ModuleItem {
    ast::ModuleItem::ModuleDecl(ast::ModuleDecl::Import(ast::ImportDecl {
        span: DUMMY_SP,
        src: ast::Str {
            span: DUMMY_SP,
            has_escape: false,
            value: src.clone(),
            kind: ast::StrKind::Normal {
                contains_quote: false,
            },
        },
        asserts: None,
        type_only: false,
        specifiers: vec![ast::ImportSpecifier::Named(ast::ImportNamedSpecifier {
            is_type_only: false,
            span: DUMMY_SP,
            local: new_ident_from_id(local),
            imported: None,
        })],
    }))
}

fn create_inline_qrl(qwik_ident: &Id, url: JsWord, symbol: &str, idents: &[Id]) -> ast::CallExpr {
    let mut args = vec![
        ast::Expr::Arrow(ast::ArrowExpr {
            is_async: false,
            is_generator: false,
            span: DUMMY_SP,
            params: vec![],
            return_type: None,
            type_params: None,
            body: ast::BlockStmtOrExpr::Expr(Box::new(ast::Expr::Call(ast::CallExpr {
                callee: ast::Callee::Expr(Box::new(ast::Expr::Ident(ast::Ident::new(
                    "import".into(),
                    DUMMY_SP,
                )))),
                span: DUMMY_SP,
                type_args: None,
                args: vec![ast::ExprOrSpread {
                    spread: None,
                    expr: Box::new(ast::Expr::Lit(ast::Lit::Str(ast::Str {
                        span: DUMMY_SP,
                        value: url,
                        has_escape: false,
                        kind: ast::StrKind::Synthesized,
                    }))),
                }],
            }))),
        }),
        ast::Expr::Lit(ast::Lit::Str(ast::Str {
            span: DUMMY_SP,
            value: symbol.into(),
            has_escape: false,
            kind: ast::StrKind::Synthesized,
        })),
    ];

    // Injects state
    if !idents.is_empty() {
        args.push(ast::Expr::Array(ast::ArrayLit {
            span: DUMMY_SP,
            elems: idents
                .iter()
                .map(|id| {
                    Some(ast::ExprOrSpread {
                        spread: None,
                        expr: Box::new(ast::Expr::Ident(new_ident_from_id(id))),
                    })
                })
                .collect(),
        }))
    }

    create_internal_call(qwik_ident, &QRL, args, None)
}

pub fn create_internal_call(
    qwik_ident: &Id,
    fn_name: &JsWord,
    exprs: Vec<ast::Expr>,
    mark: Option<Mark>,
) -> ast::CallExpr {
    let span = mark.map_or(DUMMY_SP, |mark| DUMMY_SP.apply_mark(mark));
    ast::CallExpr {
        callee: ast::Callee::Expr(Box::new(ast::Expr::Member(ast::MemberExpr {
            obj: Box::new(ast::Expr::Ident(new_ident_from_id(qwik_ident))),
            prop: ast::MemberProp::Ident(ast::Ident::new(fn_name.clone(), DUMMY_SP)),
            span: DUMMY_SP,
        }))),
        span,
        type_args: None,
        args: exprs
            .into_iter()
            .map(|expr| ast::ExprOrSpread {
                spread: None,
                expr: Box::new(expr),
            })
            .collect(),
    }
}

fn escape_sym(str: &str) -> String {
    str.chars()
        .flat_map(|x| match x {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '_' => Some(x),
            '$' => None,
            _ => Some('_'),
        })
        .collect()
}

const fn can_capture_scope(expr: &ast::Expr) -> bool {
    matches!(expr, &ast::Expr::Fn(_) | &ast::Expr::Arrow(_))
}

fn base64(nu: u64) -> String {
    base64::encode_config(nu.to_le_bytes(), base64::URL_SAFE_NO_PAD)
        .replace('-', "0")
        .replace('_', "0")
}

fn compute_scoped_idents(all_idents: &[Id], all_decl: &HashSet<Id>) -> Vec<Id> {
    let mut set: HashSet<Id> = HashSet::new();
    for ident in all_idents {
        if all_decl.contains(ident) {
            set.insert(ident.clone());
        }
    }
    let mut output: Vec<Id> = set.into_iter().collect();
    output.sort();
    output
}
