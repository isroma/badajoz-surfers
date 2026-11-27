import { describe, expect, it } from "vitest";
import { chooseTurn, eventTurn, type TrackTurn } from "./guidance";

const track = (ahead: number, len: number, dir: TrackTurn["dir"] = "left", roundabout = false): TrackTurn => ({ ahead, toEnd: ahead + len, dir, roundabout, name: "Calle San Juan" });

describe("turn hint", () => {
  it("shows the track's nearest turn from 120 m ahead until its end", () => {
    expect(chooseTurn(0, null, track(130, 30))).toBeNull();
    expect(chooseTurn(0, null, track(110, 30))?.dir).toBe("left");
    // Inside a long roundabout (Elvas ring ~215 m) it stays up until the exit.
    expect(chooseTurn(0, null, track(-200, 215, "right", true))).toEqual({ dir: "right", roundabout: true, name: "Calle San Juan" });
    expect(chooseTurn(0, null, track(-216, 215))).toBeNull();
  });

  it("prefers the nearest turn over a later event without an exact end", () => {
    // At p = 4721 a left at 4758 comes before the right at 4840 that the last event announced.
    const ev = eventTurn(4721, { direction: "right", roundabout: false, street: "Calle San Atón", distance: 119 });
    expect(chooseTurn(4721, ev, track(37, 20, "left"))?.dir).toBe("left");
  });

  it("uses events with an exact end over the track model", () => {
    const ev = eventTurn(1000, { direction: "left", roundabout: true, street: "Avenida de Elvas", distance: 100, endDistance: 315 });
    expect(chooseTurn(1000, ev, track(20, 10, "right"))?.dir).toBe("left");
    expect(chooseTurn(1310, ev, null)?.roundabout).toBe(true);
    expect(chooseTurn(1320, ev, null)).toBeNull();
  });

  it("falls back to events alone, with an estimated end", () => {
    const ev = eventTurn(0, { direction: "straight", roundabout: true, street: null, distance: 100 });
    expect(chooseTurn(50, ev, null)?.dir).toBe("straight");
    expect(chooseTurn(400, ev, null)).toBeNull();
    expect(eventTurn(0, { direction: "up" })).toBeNull();
  });
});
