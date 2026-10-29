import { describe, expect, test } from "bun:test"
import {
  TRANSCRIPT_BACKFILL_CHUNK,
  TRANSCRIPT_TAIL_ROWS,
  isAtBottom,
  isNearTop,
  rowWeight,
  rowsBefore,
} from "./mount-budget"

// NAVI renders one row per message, so every row costs a single budget slot.
const slots = () => rowWeight(1)

describe("mount budget", () => {
  test("a budget of 40 with 1000 rows selects the last 40", () => {
    const rows = 1000
    const start = rowsBefore(slots, rows, TRANSCRIPT_TAIL_ROWS)

    expect(start).toBe(960)
    expect(rows - start).toBe(40)
  })

  test("a budget of 40 with 10 rows selects all 10", () => {
    const rows = 10
    const start = rowsBefore(slots, rows, TRANSCRIPT_TAIL_ROWS)

    expect(start).toBe(0)
    expect(rows - start).toBe(10)
  })

  test("backfilling returns the next chunk of 60 older rows", () => {
    const start = rowsBefore(slots, 1000, TRANSCRIPT_TAIL_ROWS)
    const older = rowsBefore(slots, start, TRANSCRIPT_BACKFILL_CHUNK)

    expect(older).toBe(900)
    expect(start - older).toBe(60)
  })

  test("backfilling past the start returns an empty chunk", () => {
    const older = rowsBefore(slots, 0, TRANSCRIPT_BACKFILL_CHUNK)

    expect(older).toBe(0)
    expect(0 - older).toBe(0)
  })

  test("backfilling past the start never walks off the transcript", () => {
    let start = 0
    for (let chunk = 0; chunk < 5; chunk++) start = rowsBefore(slots, start, TRANSCRIPT_BACKFILL_CHUNK)

    expect(start).toBe(0)
  })

  test("a collapsed group costs a single budget slot", () => {
    expect(rowWeight(20, true)).toBe(1)
    expect(rowWeight(20)).toBe(20)
  })
})

describe("reader position", () => {
  test("a reader at the bottom is recognised as being at the bottom", () => {
    // 40 rows of content in a 20 row viewport, scrolled to the last row.
    expect(isAtBottom(20, 20, 40)).toBe(true)
  })

  test("a reader one row short of the bottom still counts as being at the bottom", () => {
    expect(isAtBottom(19, 20, 40)).toBe(true)
  })

  test("a reader above the bottom is not at the bottom", () => {
    expect(isAtBottom(18, 20, 40)).toBe(false)
    expect(isAtBottom(0, 20, 40)).toBe(false)
  })

  test("content shorter than the viewport is at the bottom", () => {
    expect(isAtBottom(0, 20, 10)).toBe(true)
  })

  test("older rows backfill within one viewport of the top", () => {
    expect(isNearTop(0, 20)).toBe(true)
    expect(isNearTop(20, 20)).toBe(true)
    expect(isNearTop(21, 20)).toBe(false)
  })
})
