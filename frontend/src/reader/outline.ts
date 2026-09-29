import type { OutlineItem } from './pdf'

/** Every entry of an outline, in reading order. */
export function flatten(items: OutlineItem[]): OutlineItem[] {
  return items.flatMap((item) => [item, ...flatten(item.items)])
}

/** The last entry, in reading order, that starts on or before `page`. */
export function currentItem(flat: OutlineItem[], page: number): OutlineItem | null {
  let found: OutlineItem | null = null
  for (const item of flat) {
    if (item.page !== null && item.page <= page) found = item
  }
  return found
}
