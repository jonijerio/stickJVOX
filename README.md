# Stick Fight: Arena Brawl

Fast-paced 2D physics stickman arena brawler inspired by *Stick Fight: The Game*, built with React, TypeScript, Tailwind CSS, Canvas2D, and Web Audio. Battle friends locally or take on AI bots across hazard-packed stages with parachute weapon drops, destructible platforms, persistent splatter decals, PlayStation controller support, and explosive victory celebrations.

---

## Features

- **4 Play Modes & Scalable AI**
  - `1P Duel` (1v1), `1P 4-Way` (4-fighter free-for-all), `2P Local` (shared-keyboard or dual-controller 1v1), and `2P + Bots` (2 humans + 2 bots).
  - Three AI difficulty tiers (`Casual`, `Standard`, `Intense`) with distinct bot archetypes (`Brawler`, `Sharpshooter`, `Trickster`).
  - Configurable match length (`First to 3` or `First to 5` rounds).
- **5 Dynamic Arenas**
  - **Steel Foundry**: Multi-tier industrial girders and breakable wooden bridges/crates.
  - **Magma Bridges**: Suspension spans suspended over bubbling molten slag.
  - **Laser Grid Lab**: Timed horizontal & vertical defense lasers with clear telegraph warnings.
  - **Cryo Pendulum**: Low-friction ice decks, green bounce pads, and a swinging wrecking ball.
  - **Sky Pillars**: High-altitude vertical columns tuned for wall-jumping and ring-outs.
- **7 Weapons & Throwing Combat**
  - **Fists** (quick melee combo), **Pistol**, **Shotgun**, **SMG**, **Katana** (dash slash), **Rocket Launcher** (explosive splash + destructible terrain damage), and **Rail Laser** (piercing beam).
  - Throw equipped weapons mid-fight to knock back or finish opponents.
  - Perfect **Parry** (`0.16s` block startup window) deflects incoming hits and stuns attackers; holding **Block** mitigates `70%` damage and `55%` knockback.
- **Articulated Stickman Physics & Cosmetics**
  - Squash-and-stretch takeoffs/landings, flowing headbands, hitstop freeze frames, speed afterimages, and flailing ragdoll KOs.
  - Customize **colors** (`8` swatches) and **costume patterns** (`Solid`, `Stripes`, `Core`, `Viper`, `Crown`) for every player and bot slot in the lobby.
  - Switchable splatter style: **Crimson** or **Fighter Ink** (matches the hit fighter's color), painting persistent blood/ink decals onto floors and walls.
- **PlayStation DualShock / DualSense & On-Screen PS Pad**
  - Plug-and-play physical PlayStation controller support via the browser Gamepad API (with rumble feedback on hits, parries, and victories).
  - Built-in toggleable **Virtual PS Pad** overlay (`✕`, `□`, `○`, `△` + D-pad/stick) for touch or mouse play.
- **Cinematic Post-Match Victory Celebration**
  - Randomized winner poses (**Victory Wave**, **Victory Leap**, **Champion Flex**).
  - **Radial Bloom & Light Flare** originating from the winner (additive volumetric rays, anamorphic horizontal lens flare, 4-point star glint, and optical bokeh).
  - **Movement-Reactive Screen Shake** driven by jump launches, landing stomps, and pose energy.
  - **Explosive Limb Confetti & Oversized Ribbon Streamers** launching radially from the winner's hands and feet alongside aerial fireworks.

---

## Controls

### PlayStation Controller / On-Screen PS Pad
| Button | Action |
| --- | --- |
| **Left Stick / D-Pad** | Move & Drop Through Platforms |
| **Right Stick** | 360° Weapon Aiming |
| **✕ (Cross)** | Jump / Wall-Jump |
| **□ (Square)** | Attack / Fire |
| **○ (Circle)** | Block / Timed Parry |
| **△ (Triangle)** | Throw Equipped Weapon |
| **Options** | Pause / Resume |

### Keyboard
| Action | Player 1 (`1P` also supports Arrows / `J K L`) | Player 2 (`2P Local` / `2P + Bots`) |
| --- | --- | --- |
| **Move / Crouch** | `W` `A` `S` `D` | `↑` `←` `↓` `→` |
| **Jump** | `W` or `Space` | `↑` |
| **Attack / Shoot** | `F` (or `J` in 1P) | `K` or `/` |
| **Block / Parry** | `G` (or `K` in 1P) | `L` or `.` |
| **Throw Weapon** | `E` (or `L` in 1P) | `U` or `'` |

### Global Shortcuts
- `Esc` or `P` — Pause / Resume
- `M` — Mute / Unmute procedural Web Audio SFX
- `R` — Quick Restart Match

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4
- **Rendering & Simulation**: Custom Canvas2D 60 FPS engine (`requestAnimationFrame` with clamped `dt`, hitstop, trauma-squared camera shake, and zero-GC object pools)
- **Audio & Input**: Web Audio API procedural sound synthesizer (`sound.ts`) and Gamepad API hub (`gamepad.ts`)
- **Build & Test**: Vite 8, `tsx`, Node built-in test runner (`node:test`)

---

## Project Structure

```text
src/
├── App.tsx                  # Root shell, config persistence, and phase routing
├── components/
│   ├── TitleOverlay.tsx     # Lobby mode/AI/cosmetic drawer and start lockup
│   ├── HudOverlay.tsx       # Corner fighter HP/weapon HUD & utility controls
│   ├── StatusModal.tsx      # Pause and Match Result summary modal
│   └── VirtualPsPad.tsx     # Interactive on-screen PlayStation controller overlay
└── game/
    ├── engine.ts            # Main simulation loop, physics, combat, hazards, victory flow
    ├── renderer.ts          # Canvas2D arena, stickmen, bloom/flare, particles, decals
    ├── particles.ts         # Pooled particle ring buffer & persistent surface decals
    ├── rules.ts             # Pure combat, hazard, rig, shake, emitter & bloom math
    ├── rules.test.ts        # Unit tests for pure game rules & particle systems
    ├── ai.ts                # Bot decision policies & difficulty tuning
    ├── arenas.ts            # 5 multi-tier arena definitions
    ├── weapons.ts           # Weapon specs & parachute drop pool
    ├── cosmetics.ts         # Color swatches, patterns & localStorage config persistence
    ├── gamepad.ts           # DualShock/DualSense & Virtual PS Pad input mapping
    ├── sound.ts             # Procedural Web Audio combat & victory sound effects
    └── types.ts             # Shared TypeScript interfaces and state types
```

---

## Getting Started

```bash
# Install dependencies
npm install

# Start the development server on http://localhost:3000
npm run dev

# Run unit tests
npx tsx --test src/game/rules.test.ts

# Type-check & build for production
npm run lint
npm run build
```
