import { FighterInputState } from './types';

export interface VirtualPsPadState {
  moveX: number; // -1 .. 1
  moveY: number; // -1 .. 1
  cross: boolean;
  square: boolean;
  circle: boolean;
  triangle: boolean;
}

export interface GamepadSnapshot {
  buttons: ReadonlyArray<{ pressed: boolean; value?: number }>;
  axes: ReadonlyArray<number>;
}

const STICK_DEADZONE = 0.25;
const AIM_DEADZONE = 0.35;

/**
 * Pure mapper from a W3C standard Gamepad (DualShock 4 / DualSense / PS controller)
 * to Stick Fight's FighterInputState:
 * - Cross (button 0): Jump
 * - Circle (button 1): Block / Parry
 * - Square (button 2): Attack / Shoot
 * - Triangle (button 3): Throw Weapon
 * - D-Pad (12..15) & L-Stick (axes 0, 1): Move / Aim / Drop-Through
 * - R-Stick (axes 2, 3): 360° Free Aim
 */
export function mapGamepadToFighterInput(
  pad: GamepadSnapshot,
  prevButtons: ReadonlyArray<boolean>
): { input: FighterInputState; nextButtons: boolean[]; optionsJustPressed: boolean } {
  const btns = pad.buttons;
  const pressed = (idx: number): boolean => Boolean(btns[idx]?.pressed || (btns[idx]?.value ?? 0) > 0.5);
  const justPressed = (idx: number): boolean => pressed(idx) && !prevButtons[idx];

  const lx = pad.axes[0] ?? 0;
  const ly = pad.axes[1] ?? 0;
  const rx = pad.axes[2] ?? 0;
  const ry = pad.axes[3] ?? 0;

  const dpadUp = pressed(12);
  const dpadDown = pressed(13);
  const dpadLeft = pressed(14);
  const dpadRight = pressed(15);

  const left = dpadLeft || lx < -STICK_DEADZONE;
  const right = dpadRight || lx > STICK_DEADZONE;
  const up = dpadUp || ly < -0.55;
  const down = dpadDown || ly > 0.55;

  let aimAngleOverride: number | null = null;
  if (Math.hypot(rx, ry) > AIM_DEADZONE) {
    aimAngleOverride = Math.atan2(ry, rx);
  }

  const nextButtons = btns.map((_, i) => pressed(i));

  return {
    input: {
      left,
      right,
      up,
      down,
      jumpJustPressed: justPressed(0), // Cross (✕)
      jumpHeld: pressed(0),
      blockJustPressed: justPressed(1), // Circle (○)
      blockHeld: pressed(1),
      attackJustPressed: justPressed(2), // Square (□)
      attackHeld: pressed(2),
      throwJustPressed: justPressed(3), // Triangle (△)
      aimAngleOverride,
    },
    nextButtons,
    optionsJustPressed: justPressed(9), // Options / Start
  };
}

export function createEmptyInput(): FighterInputState {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
    jumpJustPressed: false,
    jumpHeld: false,
    attackJustPressed: false,
    attackHeld: false,
    blockHeld: false,
    blockJustPressed: false,
    throwJustPressed: false,
    aimAngleOverride: null,
  };
}

export function mergeFighterInputs(
  a: FighterInputState,
  b: FighterInputState
): FighterInputState {
  return {
    left: a.left || b.left,
    right: a.right || b.right,
    up: a.up || b.up,
    down: a.down || b.down,
    jumpJustPressed: a.jumpJustPressed || b.jumpJustPressed,
    jumpHeld: a.jumpHeld || b.jumpHeld,
    attackJustPressed: a.attackJustPressed || b.attackJustPressed,
    attackHeld: a.attackHeld || b.attackHeld,
    blockHeld: a.blockHeld || b.blockHeld,
    blockJustPressed: a.blockJustPressed || b.blockJustPressed,
    throwJustPressed: a.throwJustPressed || b.throwJustPressed,
    aimAngleOverride: b.aimAngleOverride ?? a.aimAngleOverride ?? null,
  };
}

/**
 * Manages live PlayStation / Web Gamepad polling, virtual PS pad merging, and rumble feedback.
 */
export class PsGamepadHub {
  private prevPadButtons = new Map<number, boolean[]>();
  private prevVirtual = { cross: false, square: false, circle: false, triangle: false };
  private virtualState: VirtualPsPadState = {
    moveX: 0,
    moveY: 0,
    cross: false,
    square: false,
    circle: false,
    triangle: false,
  };

  public setVirtualState(next: Partial<VirtualPsPadState>): void {
    Object.assign(this.virtualState, next);
  }

  public clearVirtualState(): void {
    this.virtualState = {
      moveX: 0,
      moveY: 0,
      cross: false,
      square: false,
      circle: false,
      triangle: false,
    };
    this.prevVirtual = { cross: false, square: false, circle: false, triangle: false };
  }

  public getConnectedCount(): number {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return 0;
    const pads = navigator.getGamepads();
    let count = 0;
    for (let i = 0; i < pads.length; i++) {
      if (pads[i]?.connected) count++;
    }
    return count;
  }

  public pollSlot(
    slotIndex: number,
    includeVirtual: boolean
  ): { input: FighterInputState; optionsJustPressed: boolean } {
    let combined = createEmptyInput();
    let optionsJustPressed = false;

    if (typeof navigator !== 'undefined' && navigator.getGamepads) {
      const rawPads = navigator.getGamepads();
      const connectedPads: Gamepad[] = [];
      for (let i = 0; i < rawPads.length; i++) {
        const p = rawPads[i];
        if (p && p.connected) connectedPads.push(p);
      }

      const pad = connectedPads[slotIndex];
      if (pad) {
        const prev = this.prevPadButtons.get(pad.index) ?? [];
        const mapped = mapGamepadToFighterInput(pad, prev);
        this.prevPadButtons.set(pad.index, mapped.nextButtons);
        combined = mergeFighterInputs(combined, mapped.input);
        optionsJustPressed = mapped.optionsJustPressed;
      }
    }

    if (includeVirtual && slotIndex === 0) {
      const v = this.virtualState;
      const vInput: FighterInputState = {
        left: v.moveX < -0.3,
        right: v.moveX > 0.3,
        up: v.moveY < -0.5,
        down: v.moveY > 0.5,
        jumpJustPressed: v.cross && !this.prevVirtual.cross,
        jumpHeld: v.cross,
        attackJustPressed: v.square && !this.prevVirtual.square,
        attackHeld: v.square,
        blockJustPressed: v.circle && !this.prevVirtual.circle,
        blockHeld: v.circle,
        throwJustPressed: v.triangle && !this.prevVirtual.triangle,
        aimAngleOverride: null,
      };
      this.prevVirtual = {
        cross: v.cross,
        square: v.square,
        circle: v.circle,
        triangle: v.triangle,
      };
      combined = mergeFighterInputs(combined, vInput);
    }

    return { input: combined, optionsJustPressed };
  }

  public triggerRumble(slotIndex: number, intensity = 0.5, durationMs = 110): void {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const rawPads = navigator.getGamepads();
    const connectedPads: Gamepad[] = [];
    for (let i = 0; i < rawPads.length; i++) {
      const p = rawPads[i];
      if (p && p.connected) connectedPads.push(p);
    }
    const pad = connectedPads[slotIndex] as
      | (Gamepad & {
          vibrationActuator?: {
            playEffect: (
              type: string,
              params: {
                duration: number;
                strongMagnitude: number;
                weakMagnitude: number;
              }
            ) => Promise<void>;
          };
        })
      | undefined;
    if (pad?.vibrationActuator?.playEffect) {
      pad.vibrationActuator
        .playEffect('dual-rumble', {
          duration: durationMs,
          strongMagnitude: Math.min(1, intensity),
          weakMagnitude: Math.min(1, intensity * 0.65),
        })
        .catch(() => {});
    }
  }
}
