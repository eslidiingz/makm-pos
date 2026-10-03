import { describe, expect, it } from 'vitest'

import { applyReorder } from '@/lib/catalog-order'

type Row = { archived: boolean; categoryId: string; id: string; sortOrder: number }

function row(id: string, sortOrder: number, categoryId = 'meat', archived = false): Row {
  return { archived, categoryId, id, sortOrder }
}

describe('applyReorder', () => {
  it('moves items into the requested order inside the shared list', () => {
    const all = [row('a', 0), row('b', 1), row('c', 2)]
    const next = applyReorder(all, [all[1], all[0], all[2]])
    expect(next.map((item) => item.id)).toEqual(['b', 'a', 'c'])
    expect(next.map((item) => item.sortOrder)).toEqual([0, 1, 2])
  })

  it('keeps untouched items in their original slots', () => {
    const meatA = row('a', 0)
    const meatB = row('b', 1)
    const veg = row('v', 0, 'veg')
    const archived = row('z', 9, 'meat', true)
    const next = applyReorder([meatA, veg, meatB, archived], [meatB, meatA])
    expect(next.map((item) => item.id)).toEqual(['b', 'v', 'a', 'z'])
    expect(next[1]).toBe(veg)
    expect(next[3]).toBe(archived)
  })

  it('does not mutate the source list', () => {
    const all = [row('a', 0), row('b', 1)]
    applyReorder(all, [all[1], all[0]])
    expect(all.map((item) => item.id)).toEqual(['a', 'b'])
    expect(all[0].sortOrder).toBe(0)
  })
})
