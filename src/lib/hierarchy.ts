import type { HierarchyMode, HierarchyNode } from '@/state/store'
import { uriToPath } from './lspConvert'

/** Shared shape of LSP's CallHierarchyItem and TypeHierarchyItem. */
interface HierarchyItem {
  name: string
  kind: number
  detail?: string
  uri: string
  range: { start: { line: number; character: number } }
  selectionRange: { start: { line: number; character: number } }
  data?: unknown
}

let counter = 0

export function toNode(item: HierarchyItem, callSites?: any[]): HierarchyNode {
  const position = item.selectionRange?.start ?? item.range?.start ?? { line: 0, character: 0 }
  return {
    id: `h${++counter}`,
    name: item.name,
    detail: item.detail ?? '',
    file: uriToPath(item.uri),
    line: position.line + 1,
    column: position.character + 1,
    kind: item.kind,
    item,
    callSites: callSites?.map((range: any) => ({
      line: range.start.line + 1,
      column: range.start.character + 1,
    })),
  }
}

/** Fetches one level of the hierarchy below `item`. */
export async function fetchChildren(
  mode: HierarchyMode,
  language: string,
  item: unknown,
): Promise<HierarchyNode[]> {
  const lsp = window.nova.lsp
  switch (mode) {
    case 'callers': {
      const result = await lsp.incomingCalls(language, item).catch(() => null)
      return Array.isArray(result) ? result.map((c: any) => toNode(c.from, c.fromRanges)) : []
    }
    case 'callees': {
      const result = await lsp.outgoingCalls(language, item).catch(() => null)
      return Array.isArray(result) ? result.map((c: any) => toNode(c.to, c.fromRanges)) : []
    }
    case 'supertypes': {
      const result = await lsp.supertypes(language, item).catch(() => null)
      return Array.isArray(result) ? result.map((i: any) => toNode(i)) : []
    }
    case 'subtypes': {
      const result = await lsp.subtypes(language, item).catch(() => null)
      return Array.isArray(result) ? result.map((i: any) => toNode(i)) : []
    }
  }
}

export async function prepareRoot(
  mode: HierarchyMode,
  language: string,
  file: string,
  line: number,
  column: number,
): Promise<HierarchyNode | null> {
  const lsp = window.nova.lsp
  const isCall = mode === 'callers' || mode === 'callees'
  const result = await (isCall
    ? lsp.prepareCallHierarchy(file, language, line - 1, column - 1)
    : lsp.prepareTypeHierarchy(file, language, line - 1, column - 1)
  ).catch(() => null)
  const items = Array.isArray(result) ? result : result ? [result] : []
  return items.length ? toNode(items[0]) : null
}

/** Depth-first search for a node by id, returning a mutable copy path. */
export function mapNode(
  nodes: HierarchyNode[],
  id: string,
  update: (node: HierarchyNode) => HierarchyNode,
): HierarchyNode[] {
  return nodes.map((node) => {
    if (node.id === id) return update(node)
    if (node.children) return { ...node, children: mapNode(node.children, id, update) }
    return node
  })
}

export function findNode(nodes: HierarchyNode[], id: string): HierarchyNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.children) {
      const found = findNode(node.children, id)
      if (found) return found
    }
  }
  return null
}
