/**
 * Raw input capture. Deliberately dumb: it records what the hardware said this
 * frame and nothing else. The controller decides what any of it means, which is
 * also what lets the test harness drive a player by writing to `synthetic`.
 */
export interface InputFrame {
  moveX: number;        // -1 left .. 1 right
  moveZ: number;        // -1 back .. 1 forward
  lookX: number;        // accumulated mouse dx this frame
  lookY: number;
  jump: boolean;        // held
  jumpPressed: boolean; // edge
  sprint: boolean;
  crouch: boolean;
  interact: boolean;
  interactPressed: boolean;
  primary: boolean;
  primaryPressed: boolean;
  primaryReleased: boolean;
  secondary: boolean;
  secondaryPressed: boolean;
  secondaryReleased: boolean;
  dropPressed: boolean;
  slot: number;         // 0 = none, 1..4 = requested slot
  scroll: number;
}

const EMPTY: InputFrame = {
  moveX: 0, moveZ: 0, lookX: 0, lookY: 0,
  jump: false, jumpPressed: false, sprint: false, crouch: false,
  interact: false, interactPressed: false,
  primary: false, primaryPressed: false, primaryReleased: false,
  secondary: false, secondaryPressed: false, secondaryReleased: false,
  dropPressed: false, slot: 0, scroll: 0,
};

export class PlayerInput {
  frame: InputFrame = { ...EMPTY };
  /** When set, replaces hardware input entirely (used by automated tests). */
  synthetic: Partial<InputFrame> | null = null;
  enabled = true;
  pointerLocked = false;
  sensitivity = 0.0022;
  invertY = false;

  /**
   * Largest mouse delta accepted from one event, in pixels. Chromium can report
   * a very large `movementX/Y` on the first move after pointer lock engages
   * (the jump from the cursor's last screen position), and a single 400 px
   * spike at the default sensitivity is a 50 degree flick. Real mice do not
   * move this far in one event; a spike is always a bug in someone's browser.
   */
  private static readonly MAX_MOVE_PX = 260;

  private keys = new Set<string>();
  /**
   * Edges are LATCHED, not derived. A press is recorded by the event handler
   * and stays pending until a fixed step has actually consumed it
   * (`consumeEdges`). Deriving "pressed" from a per-frame key-set diff was
   * subtly wrong: edges were computed once per rendered frame but read once
   * per fixed step, so any frame that ran zero steps - most frames on a 120 or
   * 144 Hz monitor, the odd frame anywhere - lost the press entirely. Jump,
   * pick and click were silently dropped about half the time on fast displays,
   * and a 60 Hz test harness could never see it.
   */
  private keyPresses = new Set<string>();
  private buttonPresses = new Set<number>();
  private buttonReleases = new Set<number>();
  private mouseDx = 0;
  private mouseDy = 0;
  /** Discard the first move after lock: see MAX_MOVE_PX. */
  private swallowNextMove = false;
  private scrollAcc = 0;
  private buttons = new Set<number>();
  private slotRequest = 0;
  private canvas: HTMLElement;
  private disposers: Array<() => void> = [];

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
    this.bind();
  }

  private bind(): void {
    const on = (t: EventTarget, k: string, fn: (e: Event) => void) => {
      t.addEventListener(k, fn as EventListener);
      this.disposers.push(() => t.removeEventListener(k, fn as EventListener));
    };

    on(window, 'keydown', (ev) => {
      const e = ev as KeyboardEvent;
      if (e.repeat) return;
      this.keys.add(e.code);
      this.keyPresses.add(e.code);
      const n = /^Digit([1-9])$/.exec(e.code);
      if (n) this.slotRequest = parseInt(n[1], 10);
      // Stop the browser stealing space/tab while playing.
      if (['Space', 'Tab', 'KeyE', 'KeyQ'].includes(e.code) && this.pointerLocked) e.preventDefault();
    });
    on(window, 'keyup', (ev) => { this.keys.delete((ev as KeyboardEvent).code); });
    on(window, 'blur', () => { this.keys.clear(); this.buttons.clear(); });

    on(this.canvas, 'mousedown', (e) => {
      const b = (e as MouseEvent).button;
      this.buttons.add(b);
      this.buttonPresses.add(b);
      if (!this.pointerLocked) this.requestLock();
    });
    on(window, 'mouseup', (e) => {
      const b = (e as MouseEvent).button;
      // A release only counts if the game saw the press (or the button is
      // genuinely down); a stray mouseup from outside the canvas is noise.
      if (this.buttons.has(b) || this.buttonPresses.has(b)) this.buttonReleases.add(b);
      this.buttons.delete(b);
    });
    on(window, 'mousemove', (e) => {
      if (!this.pointerLocked) return;
      if (this.swallowNextMove) { this.swallowNextMove = false; return; }
      const m = e as MouseEvent;
      const cap = PlayerInput.MAX_MOVE_PX;
      this.mouseDx += clampAbs(m.movementX || 0, cap);
      this.mouseDy += clampAbs(m.movementY || 0, cap);
    });
    on(window, 'wheel', (e) => { this.scrollAcc += Math.sign((e as WheelEvent).deltaY); });
    on(document, 'pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (this.pointerLocked) {
        // Entering pointer lock must not move the view. Drop anything queued
        // before the transition and ignore the first delta after it.
        this.mouseDx = 0; this.mouseDy = 0;
        this.swallowNextMove = true;
      } else {
        this.keys.clear(); this.buttons.clear();
      }
    });
    on(window, 'contextmenu', (e) => { if (this.pointerLocked) e.preventDefault(); });
  }

  requestLock(): void {
    if (document.pointerLockElement !== this.canvas) {
      (this.canvas as HTMLElement & { requestPointerLock(): void }).requestPointerLock();
    }
  }

  /**
   * Call once per rendered frame, before any consumer reads `frame`. Edge flags
   * reflect everything pressed since the last `consumeEdges`, which the game
   * loop calls only after a fixed step has had the chance to act on them.
   */
  sample(): InputFrame {
    const f = this.frame;
    if (this.synthetic) {
      Object.assign(f, EMPTY, this.synthetic);
      return f;
    }
    if (!this.enabled) { Object.assign(f, EMPTY); return f; }

    const k = this.keys, kp = this.keyPresses;
    const down = (c: string) => k.has(c);
    const pressed = (c: string) => kp.has(c);

    f.moveX = (down('KeyD') ? 1 : 0) - (down('KeyA') ? 1 : 0);
    f.moveZ = (down('KeyW') ? 1 : 0) - (down('KeyS') ? 1 : 0);
    f.jump = down('Space');
    f.jumpPressed = pressed('Space');
    f.sprint = down('ShiftLeft') || down('ShiftRight');
    f.crouch = down('ControlLeft') || down('ControlRight') || down('KeyC');
    f.interact = down('KeyE');
    f.interactPressed = pressed('KeyE');
    f.dropPressed = pressed('KeyQ');
    f.slot = this.slotRequest;

    f.primary = this.buttons.has(0);
    f.primaryPressed = this.buttonPresses.has(0);
    f.primaryReleased = this.buttonReleases.has(0);
    f.secondary = this.buttons.has(2);
    f.secondaryPressed = this.buttonPresses.has(2);
    f.secondaryReleased = this.buttonReleases.has(2);

    // Look is consumed per frame: it is applied per frame, see Game.tick.
    f.lookX = this.mouseDx * this.sensitivity;
    f.lookY = this.mouseDy * this.sensitivity * (this.invertY ? -1 : 1);
    f.scroll = this.scrollAcc;
    this.mouseDx = 0; this.mouseDy = 0;
    return f;
  }

  /**
   * The fixed step has acted on this frame's edges; forget them. Called by the
   * game loop after the FIRST fixed step of a frame, and not at all on a frame
   * that ran none, so a press always reaches exactly one step.
   */
  consumeEdges(): void {
    this.keyPresses.clear();
    this.buttonPresses.clear();
    this.buttonReleases.clear();
    this.slotRequest = 0;
    this.scrollAcc = 0;
    const s = this.synthetic;
    if (s) {
      delete s.jumpPressed; delete s.interactPressed; delete s.primaryPressed;
      delete s.secondaryPressed; delete s.dropPressed; delete s.primaryReleased;
      delete s.secondaryReleased; delete s.slot; delete s.scroll;
    }
    const f = this.frame;
    f.jumpPressed = false; f.interactPressed = false; f.primaryPressed = false;
    f.secondaryPressed = false; f.primaryReleased = false; f.secondaryReleased = false;
    f.dropPressed = false; f.slot = 0; f.scroll = 0;
  }

  dispose(): void { for (const d of this.disposers) d(); this.disposers.length = 0; }
}

function clampAbs(v: number, max: number): number {
  return v > max ? max : v < -max ? -max : v;
}
