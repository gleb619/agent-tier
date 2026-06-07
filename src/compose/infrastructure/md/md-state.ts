import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkStringify from 'remark-stringify'
import { visit } from 'unist-util-visit'
import type { Root, ListItem, Paragraph, Text } from 'mdast'

export interface ChecklistItem {
  index: number
  text: string
  checked: boolean
}

function buildProcessor() {
  return unified().use(remarkParse).use(remarkGfm)
}

function buildStringifier() {
  return unified().use(remarkGfm).use(remarkStringify)
}

export function parseChecklist(markdown: string): ChecklistItem[] {
  const tree = buildProcessor().parse(markdown) as Root
  const items: ChecklistItem[] = []
  let index = 0
  visit(tree, 'listItem', (node: ListItem) => {
    if (node.checked === null || node.checked === undefined) return
    const para = node.children[0] as Paragraph | undefined
    const textNode = para?.children.find(c => c.type === 'text') as Text | undefined
    items.push({ index: index++, text: textNode?.value?.trim() ?? '', checked: node.checked })
  })
  return items
}

export function setChecked(markdown: string, taskIndex: number, checked: boolean): string {
  const tree = buildProcessor().parse(markdown) as Root
  let current = 0
  visit(tree, 'listItem', (node: ListItem) => {
    if (node.checked === null || node.checked === undefined) return
    if (current === taskIndex) node.checked = checked
    current++
  })
  return buildStringifier().stringify(tree)
}

export function allDone(markdown: string): boolean {
  const items = parseChecklist(markdown)
  return items.length > 0 && items.every(i => i.checked)
}

export function pendingItems(markdown: string): ChecklistItem[] {
  return parseChecklist(markdown).filter(i => !i.checked)
}