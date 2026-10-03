/**
 * The catalog renders items in array order, so an optimistic reorder must move
 * the items inside the shared list — updating `sortOrder` alone leaves the UI
 * unchanged. Items outside `ordered` (other categories, archived rows) keep
 * their slots.
 */
export function applyReorder<T extends { id: string; sortOrder: number }>(all: T[], ordered: T[]): T[] {
  const reordered = ordered.map((item, index) => ({ ...item, sortOrder: index }))
  const movedIds = new Set(reordered.map((item) => item.id))
  let cursor = 0
  return all.map((item) => (movedIds.has(item.id) ? reordered[cursor++] : item))
}
