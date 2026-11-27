/** Surface names and the metres covered by one uv repeat (kept for uv layout; the flat style has no ground textures). */
export type GroundName = "asphalt" | "sett" | "paving" | "hydraulic" | "slabs" | "grass" | "albero" | "roofFlat" | "roofTile" | "granite" | "earth";

export const GROUND_SCALE: Record<GroundName, number> = {
  asphalt: 8, sett: 2.4, paving: 3.2, hydraulic: 1.6, slabs: 4, grass: 6, albero: 6, roofFlat: 6, roofTile: 3, granite: 2, earth: 8,
};
