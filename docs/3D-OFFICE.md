# 3D office

An optional three.js view of the office. The 2D (Pixi) scene stays the simulation: it owns
pathfinding, desks, seats and what every agent is doing. The 3D view only draws the same state.
Switch with the **2D / 3D** button on the floor selector (remembered in `localStorage`
`officex.view3d`). **HQ / LQ** (key `officex.view3dQuality`) trades shadows and sharpness for speed.

## Files (`src/renderer/src/scene/office3d/`)

| File | Job |
|---|---|
| `Office3D.ts` | Scene, lights, camera, walls, flat floor art, picking, per-frame sync |
| `FurniturePlanner.ts` | Pure TS: groups blocking furniture tiles into items (desk, chair, sofa...) |
| `Furniture3D.ts` | three.js models for each furniture kind |
| `Person3D.ts` | Low-poly person built from `personLook()` (see `scene/office/portraitArt.ts`) |
| `NameTag3D.ts` | Floating name + status dot |
| `ThoughtBubble3D.ts` | Thought/tool bubble and status glyph |

`OfficeFloor.tsx` creates `Office3D` when the toggle is on, hides the Pixi canvas, and calls
`frame()` from the ticker with one `Person3DState` per agent (local and Shared Office teammates).

## How it maps

World units are tiles (1 unit = 16 px), x east, z south, y up. Floor and any furniture the planner
does not recognise are baked from the tilesets (`bakeLayers`); walls are extruded; recognised
furniture is replaced by models.

## Controls

Drag = orbit, wheel = zoom, right-drag = pan, click a person = select and fly to them,
double-click = back to the starting view. Teammates are drawn but not selectable.

## Known limits

- Furniture the planner cannot classify becomes a plain block.
- Without a GPU the app runs at about 12 fps in 2D and 3D alike (software rendering).
- Linux/Wayland: Electron needs `--ozone-platform=x11` here (`npm run dev -- -- --ozone-platform=x11`).
- Tested on Linux only.

## Lighting and memory (v3)
- Light follows the local clock: amber low sun at dawn and dusk, bright at noon, dim but readable at night. It updates once a minute and only changes existing lights.
- Shadow map is 1024 px, and LQ frees it entirely.
- Furniture geometry and materials are shared between items instead of created per item.
