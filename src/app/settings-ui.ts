import { MAX_DRAW_DISTANCE, MAX_NPCS, MIN_DRAW_DISTANCE } from "../engine/limits.ts";
import { icon } from "./ui.ts";

export function mountSettingsUI(): void {
  document.querySelector(".top-actions")!.insertAdjacentHTML(
    "afterbegin",
    `
    <button class="icon-button settings-launch" id="settings-open" aria-label="Settings" title="Settings">${icon("settings", 19)}</button>
    <button class="fullscreen-launch" id="fullscreen-open" aria-label="Enter fullscreen game mode" title="Fullscreen game mode (G)">${icon("expand", 17)}<span>Play fullscreen</span></button>
  `,
  );
  document.getElementById("viewport")!.insertAdjacentHTML(
    "beforeend",
    `
    <div class="game-hud"><div class="game-location">${icon("compass", 20)}<div><strong id="game-location">Mosslight Hollow</strong><span id="game-quest">0 / 3 beacons · 0 light shards</span></div></div>
    <nav class="game-menu" aria-label="Game controls">
      <button class="icon-button" id="game-map" aria-label="Game atlas" title="Atlas (M)">${icon("map", 18)}</button>
      <button class="icon-button" id="game-journal" aria-label="Game journal" title="Expedition journal" aria-expanded="false">${icon("leaf", 18)}</button>
      <button class="icon-button" id="game-sound" aria-label="Enable game sound" aria-pressed="false" title="Sound">${icon("mute", 18)}</button>
      <button class="icon-button" id="game-settings" aria-label="Game settings" title="Settings">${icon("settings", 18)}</button>
      <span class="game-menu-divider"></span><button class="icon-button" id="fullscreen-exit" aria-label="Exit fullscreen game mode" title="Exit game mode (Esc / G)">${icon("collapse", 18)}</button>
    </nav></div>
    <div class="game-performance" id="game-performance"><span class="live-dot"></span><strong id="game-fps">60 FPS</strong><span id="game-entities">0 visible · 2,400 active</span></div>
  `,
  );
  document.getElementById("app")!.insertAdjacentHTML(
    "beforeend",
    `
    <dialog id="settings-dialog" aria-labelledby="settings-title">
      <form method="dialog"><button class="dialog-close icon-button" aria-label="Close settings">${icon("close", 20)}</button></form>
      <span class="eyebrow">MAKE ROOM FOR MORE</span><h2 id="settings-title">Your kind of wild.</h2>
      <p class="settings-intro">A wider horizon. A livelier forest. Tune the world to your machine.</p>
      <form id="settings-form">
        <div class="settings-presets" aria-label="Quality presets"><button type="button" data-quality="balanced">Balanced</button><button type="button" data-quality="expansive">Expansive</button><button type="button" data-quality="maximum">Maximum</button></div>
        <div class="setting-field"><div class="setting-title"><label for="setting-distance">Draw distance</label><div><input id="setting-distance-value" type="number" min="${MIN_DRAW_DISTANCE}" max="${MAX_DRAW_DISTANCE}" step="1" aria-label="Draw distance value" required /><span>units</span></div></div><input id="setting-distance" type="range" min="${MIN_DRAW_DISTANCE}" max="${MAX_DRAW_DISTANCE}" step="1" /><p>How far terrain and creatures stay visible when you zoom out.</p><div class="range-labels"><span>${MIN_DRAW_DISTANCE.toLocaleString()}</span><span>${MAX_DRAW_DISTANCE.toLocaleString()}</span></div></div>
        <div class="setting-field"><div class="setting-title"><label for="setting-entities">Visible creatures</label><input id="setting-entities-value" type="number" min="0" max="${MAX_NPCS}" step="1" aria-label="Visible creatures value" required /></div><input id="setting-entities" type="range" min="0" max="${MAX_NPCS}" step="1" /><p>The maximum drawn on screen. Nearby creatures get priority; travelers and beacons stay visible.</p><div class="range-labels"><span>0</span><span>${MAX_NPCS.toLocaleString()}</span></div></div>
        <div class="setting-field"><div class="setting-title"><label for="setting-population">World population</label><input id="setting-population-value" type="number" min="0" max="${MAX_NPCS}" step="1" aria-label="World population value" required /></div><input id="setting-population" type="range" min="0" max="${MAX_NPCS}" step="1" /><p id="population-help">How many creatures are simulated. In co-op, the host sets this for everyone.</p><div class="range-labels"><span>0</span><span>${MAX_NPCS.toLocaleString()}</span></div></div>
        <label class="check-row performance-toggle"><input type="checkbox" id="setting-performance" /> Show live performance in game mode</label>
        <div class="settings-readout"><span class="live-dot"></span><span id="settings-live">Measuring your world…</span></div>
        <div class="settings-display-row"><div><strong>Just you and the forest.</strong><span>A compact HUD, with the whole screen to explore.</span></div><button type="button" class="secondary-button" id="settings-game-mode">${icon("expand", 16)}Game mode</button></div>
        <div class="settings-trail"><button type="button" class="secondary-button" id="game-save">${icon("download", 15)}Save game</button><button type="button" class="secondary-button" id="game-load">${icon("compass", 15)}Load game</button></div>
        <p id="settings-error" class="settings-error" role="status" aria-live="polite" hidden></p>
        <div class="settings-footer"><button type="button" class="text-button" id="settings-reset">Restore defaults</button><button type="submit" class="primary-button" id="settings-apply">Apply settings ${icon("arrow", 16)}</button></div>
        <span class="settings-saved-note">Saved on this device. Higher values do more work; the live counter helps you find your balance.</span>
      </form>
    </dialog>
  `,
  );
}
