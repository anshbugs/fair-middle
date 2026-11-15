import type { GroupRow } from "./store";
import type { Constraints, SolveOptions } from "./types";

/** Helpers shared by the stores' callers. The stores themselves live in lib/store. */
export { newId, store } from "./store";
export type { GroupRow } from "./store";

export function groupOptions(g: GroupRow): SolveOptions {
  return g.options ? (JSON.parse(g.options) as SolveOptions) : { objective: g.objective };
}
export const groupConstraints = (g: GroupRow): Constraints => groupOptions(g).constraints ?? {};
