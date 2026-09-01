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

  private keys = new Set<string>();
  private prevKeys = new Set<string>();
  private mouseDx = 0;
  private mouseDy = 0;
  private scrollAcc = 0;
  private buttons = new Set<number>();
  private prevButtons = new Set<number>();
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
      const n = /^Digit([1-9])$/.exec(e.code);
      if (n) this.slotRequest = parseInt(n[1], 10);
      // Stop the browser stealing space/tab while playing.
      if (['Space', 'Tab', 'KeyE', 'KeyQ'].includes(e.code) && this.pointerLocked) e.preventDefault();
    });
    on(window, 'keyup', (ev) => { this.keys.delete((ev as KeyboardEvent).code); });
    on(window, 'blur', () => { this.keys.clear(); this.buttons.clear(); });

    on(this.canvas, 'mousedown', (e) => {
      this.buttons.add((e as MouseEvent).button);
      if (!this.pointerLocked) this.requestLock();
    });
    on(window, 'mouseup', (e) => { this.buttons.delete((e as MouseEvent).button); });
    on(window, 'mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDx += (e as MouseEvent).movementX || 0;
      this.mouseDy += (e as MouseEvent).movementY || 0;
    });
    on(window, 'wheel', (e) => { this.scrollAcc += Math.sign((e as WheelEvent).deltaY); });
    on(document, 'pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (!this.pointerLocked) { this.keys.clear(); this.buttons.clear(); }
    });
    on(window, 'contextmenu', (e) => { if (this.pointerLocked) e.preventDefault(); });
  }

  requestLock(): void {
    if (document.pointerLockElement !== this.canvas) {
      (this.canvas as HTMLElement & { requestPointerLock(): void }).requestPointerLock();
    }
  }

  /** Call once per rendered frame, before any consumer reads `frame`. */
  sample(): InputFrame {
    const f = this.frame;
    if (this.synthetic) {
      Object.assign(f, EMPTY, this.synthetic);
      // Edge flags supplied synthetically are consumed after one frame.
      const s = this.synthetic;
      if (s.jumpPressed || s.interactPressed || s.primaryPressed || s.secondaryPressed ||
        s.dropPressed || s.primaryReleased || s.secondaryReleased || s.slot) {
        delete s.jumpPressed; delete s.interactPressed; delete s.primaryPressed;
        delete s.secondaryPressed; delete s.dropPressed; delete s.primaryReleased;
        delete s.secondaryReleased; delete s.slot;
      }
      return f;
    }
    if (!this.enabled) { Object.assign(f, EMPTY); return f; }

    const k = this.keys, pk = this.prevKeys;
    const down = (c: string) => k.has(c);
    const pressed = (c: string) => k.has(c) && !pk.has(c);

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
    this.slotRequest = 0;

    f.primary = this.buttons.has(0);
    f.primaryPressed = this.buttons.has(0) && !this.prevButtons.has(0);
    f.primaryReleased = !this.buttons.has(0) && this.prevButtons.has(0);
    f.secondary = this.buttons.has(2);
    f.secondaryPressed = this.buttons.has(2) && !this.prevButtons.has(2);
    f.secondaryReleased = !this.buttons.has(2) && this.prevButtons.has(2);

    f.lookX = this.mouseDx * this.sensitivity;
    f.lookY = this.mouseDy * this.sensitivity * (this.invertY ? -1 : 1);
    f.scroll = this.scrollAcc;

    this.mouseDx = 0; this.mouseDy = 0; this.scrollAcc = 0;
    this.prevKeys = new Set(k);
    this.prevButtons = new Set(this.buttons);
    return f;
  }

  dispose(): void { for (const d of this.disposers) d(); this.disposers.length = 0; }
}
