/** The shared track model (src/city), re-exported for the city art. */
import { createFrame, type TrackFrame } from "../../city";

export type { Flow, LaneKind, LaneLayout, Track, TrackFrame, TrackStretch } from "../../city";
export const newFrame = (): TrackFrame => createFrame();
