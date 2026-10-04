import type { Simulation } from "../engine/simulation.ts";
import { finite } from "./runtime.ts";

export interface PhysicalInteraction {
  id: string;
  x: number;
  y: number;
  atX?: number;
  atY?: number;
}
/** Identity comes from the connection, never the payload. No shared configuration guest RPC. */
export function interactPhysics(
  sim: Simulation,
  playerId: string,
  request: PhysicalInteraction,
): void {
  if (
    !request ||
    typeof request.id !== "string" ||
    Object.keys(request).some((key) => !["id", "x", "y", "atX", "atY"].includes(key))
  )
    throw new Error("Invalid physical interaction; only the host can configure shared policies");
  const player = sim.players.get(playerId),
    world = sim.physical?.world;
  if (!player || !world || !world.has(request.id))
    throw new Error("Unknown physical interaction target");
  const body = world.pose(request.id);
  if (
    body.role !== "prop" ||
    body.motion !== "dynamic" ||
    body.consequences?.destroyed ||
    Math.hypot(body.x - player.x, body.y - player.y) > 96
  )
    throw new Error("Move within 96 units of a movable prop");
  finite(request.x, "interaction x", 120);
  finite(request.y, "interaction y", 120);
  if ((request.atX === undefined) !== (request.atY === undefined))
    throw new Error("Supply both interaction coordinates");
  if (
    request.atX !== undefined &&
    Math.hypot(
      finite(request.atX, "atX", 16_000_000) - body.x,
      finite(request.atY, "atY", 16_000_000) - body.y,
    ) > 32
  )
    throw new Error("Interaction point must lie near the prop");
  world.impulse(request.id, request.x, request.y, request.atX, request.atY);
}
