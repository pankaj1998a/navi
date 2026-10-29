/** Rows mounted when a session opens. */
export const TRANSCRIPT_TAIL_ROWS = 40

/** Rows mounted per backfill chunk as the reader scrolls up. */
export const TRANSCRIPT_BACKFILL_CHUNK = 60

/**
 * Slots a transcript row costs.
 *
 * The budget counts mounted rows rather than messages: a collapsed group renders a single
 * header however many messages it holds, so it costs one slot too. NAVI's transcript has no
 * grouping today, so a message renders as one row and costs one slot.
 */
export function rowWeight(entries: number, collapsed = false) {
  return collapsed ? 1 : entries
}

/**
 * First row index such that rows [index, end) spend at least `budget` slots.
 *
 * `slots` reports the slots a row costs and is consulted once per row. The walk stops at the
 * first row, so a budget larger than the transcript clamps instead of looping.
 */
export function rowsBefore(slots: (index: number) => number, end: number, budget: number) {
  let index = end
  let spent = 0
  while (index > 0 && spent < budget) spent += slots(--index)
  return index
}

/**
 * Whether the reader sits at the bottom of the transcript.
 *
 * A scroll position one row short of the bottom still counts as the bottom, so
 * the mount window does not collapse while the reader is a row away from it.
 */
export function isAtBottom(scrollTop: number, viewportHeight: number, scrollHeight: number) {
  return scrollTop + viewportHeight >= scrollHeight - 1
}

/**
 * Whether the reader is close enough to the top for older rows to backfill.
 *
 * Backfilling rows above the viewport only preserves the reader's position when
 * the reader is within one viewport of the top.
 */
export function isNearTop(scrollTop: number, viewportHeight: number) {
  return scrollTop <= viewportHeight
}
