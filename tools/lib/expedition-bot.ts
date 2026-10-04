import type { Simulation } from "../../src/engine/simulation.ts";

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
    sim.setInput(player.id, {
      x: move ? (dx / Math.max(distance, 1)) * (danger ? -1 : 1) : 0,
      y: move ? (dy / Math.max(distance, 1)) * (danger ? -1 : 1) : 0,
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
