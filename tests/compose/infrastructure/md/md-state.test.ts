import { describe, it, expect } from 'vitest'
import { parseChecklist, setChecked, allDone, pendingItems } from '../../../../src/compose/infrastructure/md/md-state'

const SAMPLE = `# Tasks

- [ ] 1. Create domain types
- [x] 2. Add tests
- [ ] 3. Wire routing
`

describe('parseChecklist', () => {
  it('returns all checkbox items with checked state', () => {
    const items = parseChecklist(SAMPLE)
    expect(items).toHaveLength(3)
    expect(items[0].checked).toBe(false)
    expect(items[1].checked).toBe(true)
    expect(items[2].checked).toBe(false)
  })
})

describe('setChecked', () => {
  it('marks item at index as checked', () => {
    const updated = setChecked(SAMPLE, 0, true)
    const items = parseChecklist(updated)
    expect(items[0].checked).toBe(true)
    expect(items[2].checked).toBe(false)
  })
  it('marks item as unchecked', () => {
    const updated = setChecked(SAMPLE, 1, false)
    expect(parseChecklist(updated)[1].checked).toBe(false)
  })
})

describe('allDone', () => {
  it('returns true when all checked', () => {
    expect(allDone('- [x] 1. A\n- [x] 2. B\n')).toBe(true)
  })
  it('returns false when any unchecked', () => {
    expect(allDone(SAMPLE)).toBe(false)
  })
})

describe('pendingItems', () => {
  it('returns only unchecked items', () => {
    const items = pendingItems(SAMPLE)
    expect(items).toHaveLength(2)
    expect(items.map(i => i.index)).toEqual([0, 2])
  })
})