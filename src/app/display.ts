/** Fullscreen owns the whole document so dialogs and the responsive HUD stay in its top layer. */
export class GameDisplay {
  gameMode = false;
  private hadFullscreen = false;
  private readonly changed: () => void;
  private readonly prepare: () => void;
  private readonly notify: (message: string) => void;

  constructor(changed: () => void, prepare: () => void, notify: (message: string) => void) {
    this.changed = changed;
    this.prepare = prepare;
    this.notify = notify;
    document.addEventListener("fullscreenchange", () => {
      const fullscreen = document.fullscreenElement === document.documentElement;
      if (fullscreen) this.setMode(true);
      else if (this.hadFullscreen) this.setMode(false);
      this.hadFullscreen = fullscreen;
      this.changed();
    });
  }
  private setMode(enabled: boolean): void {
    this.gameMode = enabled;
    document.documentElement.classList.toggle("game-mode", enabled);
    this.changed();
  }
  async enter(fullscreen = true): Promise<void> {
    this.prepare();
    this.setMode(true);
    if (!fullscreen || document.fullscreenElement === document.documentElement) return;
    try {
      if (!document.fullscreenEnabled || !document.documentElement.requestFullscreen)
        throw new Error("Fullscreen unavailable");
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      this.hadFullscreen = true;
    } catch {
      this.notify(
        "Game mode is on. This browser kept it inside the window; all game controls are available.",
      );
    }
    this.changed();
  }
  async exit(): Promise<void> {
    if (document.fullscreenElement) await document.exitFullscreen();
    this.hadFullscreen = false;
    this.setMode(false);
  }
  async toggle(): Promise<void> {
    if (this.gameMode) await this.exit();
    else await this.enter();
  }
  observe() {
    return {
      gameMode: this.gameMode,
      fullscreen: document.fullscreenElement === document.documentElement,
    };
  }
}
