import type { Simulation } from "../../src/engine/simulation.ts";

/**
 * Controller pathfinding (M10): when solid scenery (a hedge, a stockade, a stall) lies just
 * ahead, turn to the freest nearby heading, like monsters do. Still only a direction input.
 */
function steer(sim: Simulation, id: string, heading: number, radius: number): number {
  const world = sim.physical?.world,
    body = `player-${id}`;
  if (!world?.has(body)) return heading;
  const reach = 34,
    free = (a: number) =>
      world.obstacleFraction(body, Math.cos(a) * reach, Math.sin(a) * reach, radius + 1);
  if (free(heading) >= 1) return heading;
  let best = heading,
    score = -Infinity;
  for (const offset of [0.5, -0.5, 1, -1, 1.5, -1.5, 2.1, -2.1]) {
    const a = heading + offset,
      value = free(a) * 3 + Math.cos(offset);
    if (value > score) {
      score = value;
      best = a;
    }
  }
  return best;
}
/** Deterministic QA controller: only ordinary inputs and validated character actions. */
export function fightArea(
  sim: Simulation,
  maxTicks = 24000,
): { cleared: boolean; ticks: number; dead: boolean } {
  const player = sim.players.values().next().value!;
  const start = sim.tick;
  for (let i = 0; i < maxTicks && !sim.adventure.state.cleared; i++) {
    const hero = sim.adventure.hero(player.id),
      stats = sim.adventure.stats(player.id, sim.tick);
    if (hero.dead) return { cleared: false, ticks: sim.tick - start, dead: true };
    if (hero.level >= 3 && !stats.lance && hero.points >= 4) {
      for (let rank = hero.skills["gale-0"] ?? 0; rank < 3; rank++)
        sim.adventure.action(sim, player.id, { type: "skill", id: "gale-0" });
      sim.adventure.action(sim, player.id, { type: "skill", id: "gale-3" });
    }
    const nearest = sim.adventure.state.enemies
      .filter((enemy) => enemy.hp > 0)
      .sort(
        (a, b) =>
          Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y),
      )[0];
    const dx = (nearest?.x ?? player.x) - player.x,
      dy = (nearest?.y ?? player.y) - player.y,
      distance = Math.hypot(dx, dy);
    const danger =
      nearest?.phase === "windup" && nearest.timer < 13 && distance < 135 && player.energy >= 29;
    const move = distance > 32 || danger;
    let heading = Math.atan2(dy, dx) + (danger ? Math.PI : 0);
    if (move) heading = steer(sim, player.id, heading, player.radius);
    sim.setInput(player.id, {
      x: move ? Math.cos(heading) : 0,
      y: move ? Math.sin(heading) : 0,
      attack: true,
      pulse: distance < 98 && player.energy > 28,
      lance: distance > 80 && player.energy > 22,
      potion: hero.hp < stats.health * 0.55,
      dash: danger,
      interact: i % 24 === 0,
    });
    sim.step();
    for (const item of hero.inventory) {
      const equipped = hero.inventory.find((other) => other.id === hero.equipment[item.slot]);
      if (!equipped || item.power > equipped.power)
        sim.adventure.action(sim, player.id, { type: "equip", id: item.id });
    }
  }
  sim.setInput(player.id, {});
  return {
    cleared: sim.adventure.state.cleared,
    ticks: sim.tick - start,
    dead: sim.adventure.hero(player.id).dead,
  };
}
