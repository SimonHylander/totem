import { describe, expect, it } from "vitest";
import { nextSpot, sheetRows, takenWith, type Row } from "./sheet.js";

function draw(rows: Row[]): string {
  return rows
    .map((row) => {
      const w = "list" in row && row.list === "waitlist" ? "w" : "";
      switch (row.kind) {
        case "line":
          return `${w}${row.number}${row.state === "taken" ? "x" : "o"}`;
        case "range":
          return `${w}${row.from}-${row.to}${row.state === "taken" ? "x" : "o"}`;
        case "you":
          return `@${w}${row.number ?? "?"}`;
        case "rule":
          return "|";
      }
    })
    .join(" ");
}

describe("sheetRows", () => {
  it("collapses long runs around the next free seat", () => {
    expect(draw(sheetRows(20, 14, nextSpot(20, 6)))).toBe("1x 2-13x 14x @15 16o 17o 18-20o |");
  });

  it("draws every line of a small event", () => {
    expect(draw(sheetRows(2, 0, nextSpot(2, 2)))).toBe("@1 2o |");
    expect(draw(sheetRows(2, 1, nextSpot(2, 1)))).toBe("1x @2 |");
  });

  it("keeps a large event to a handful of rows", () => {
    expect(draw(sheetRows(500, 250, nextSpot(500, 250)))).toBe("1x 2-249x 250x @251 252o 253o 254-500o |");
  });

  it("puts a full event's newcomer below the rule with no number yet", () => {
    expect(draw(sheetRows(2, 2, nextSpot(2, 0)))).toBe("1x 2x | @w?");
  });

  it("places a returning attendee on their original seat", () => {
    expect(draw(sheetRows(20, 14, { list: "seats", position: 3 }))).toBe("1x 2x @3 4x 5-13x 14x 15o 16o 17-20o |");
  });

  it("shows a waitlist place with the waitlist ahead of it", () => {
    expect(draw(sheetRows(2, 2, { list: "waitlist", position: 4 }))).toBe("1x 2x | w1x w2x w3x @w4");
  });
});

describe("takenWith", () => {
  it("counts a returning attendee's earlier seat as taken", () => {
    expect(takenWith(14, { list: "seats", position: 18 })).toBe(18);
  });
});
