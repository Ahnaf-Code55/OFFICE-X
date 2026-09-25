# Architecture, project structure and design system

_Moved out of the README so that document can do its job of explaining the product._
_This is the contributor's map. Start here before your first pull request._

## Architecture

Two local data planes feed the renderer. Shared Office is a separate, optional peer plane:

```
┌───────────────────────────────────────────────────────────────┐
│                     Electron Renderer (React)                  │
│   ┌──────────────────┐    ┌──────────────────────────────┐    │
│   │ Office Floor      │    │ Terminal + Command Bar       │    │
│   │ (Pixi.js)        │    │ Files + Git tabs (xterm.js)  │    │
│   └─────────▲────────┘    └────────────▲─────────────────┘    │
│             │ avatar state             │ pty bytes / fs / git  │
└─────────────┼──────────────────────────┼───────────────────────┘
              │ IPC (contextBridge: window.cth)
       ┌──────┴──────────┐        ┌──────┴─────────────┐
       │  Event Plane    │        │  Terminal Plane    │
       │  hooks / hive   │        │  node-pty PTYs     │
       │  router + GOD   │        │  + fs + git        │
       └────────▲────────┘        └──────▲─────────────┘
                │ hook payloads          │ stdin / stdout
                └─────────┬──────────────┘
                   ┌──────┴──────────────┐
                   │ agent CLI processes │
                   └─────────────────────┘
```

- **Terminal plane.** The main process owns a `PtyManager` that spawns each agent as a `node-pty`
  process and streams output over per-id IPC (`pty:data:<id>`). The renderer talks only through a
  typed `window.cth` bridge ([`src/preload/index.ts`](../src/preload/index.ts)), which also exposes
  sandboxed filesystem and git helpers.
- **Hive / event plane.** `hive.ts` is the on-disk multi-agent layer; `hooks.ts` runs the hook
  server that provider bridges POST lifecycle payloads to (`cth-hook` for Claude Code, `agy-hook`
  for Antigravity). `memory.ts` wraps the semantic memory CLI. The router delivers messages, drains
  provider outboxes, the GOD agent adjudicates, and idle/inbox wakeups keep workers draining mail.
- **Shared Office plane.** Optional peer collaboration is isolated from the local floor and PTYs.
  Each device keeps its identity keys in the Electron main process; invitations contain public
  identity and route metadata. Teammates compare the SHA-256 fingerprint over a separate trusted
  channel and pin one another per office. The libp2p transport authenticates peers, and the
  authenticated peer identity must match a pinned member before messages are accepted. Signed,
  encrypted action messages are checked against the receiving device's current access level before
  dispatch. Task requests enter the local approval history; delegated prompts target eligible local
  agents; terminal input and output require full-control access, with output shared only after the
  owner enables it for a teammate and agent. Presence is display data and does not expose local PTY
  state. The transport can use a direct public TCP route or a Circuit Relay v2 host; relay mode
  forwards the encrypted peer connection and does not establish membership or permissions.

## Project structure

```
src/
  main/                      Electron main process (Node)
    index.ts                 window, IPC handlers, quit guard
    pty.ts                   node-pty manager (spawn/write/resize/kill/stream)
    hive.ts                  on-disk multi-agent layer (memory, mailboxes, router)
    hooks.ts                 hook server + provider hook shims (`cth-hook`, `agy-hook`)
    memory.ts                semantic memory layer (CLI wrapper, degrade-to-noop)
    config.ts                harness config persistence + home setup
    transcript.ts            reads ~/.claude/projects/ JSONL transcripts for real token/cost telemetry
    telemetry.ts             live OTel collector + usage/cost feed for observability
    usage.ts / pricing.ts    UsageProvider seam + per-model cost attribution
    breaker.ts / control.ts  cost/runaway circuit breaker (steer/constrain/stop) + HITL gate / steer / stop
    reflect.ts               MemoryReflector — memory condensation
    db.ts                    SQLite durable store (window bounds + history) + durable cost ledger
    github.ts                GitHub issue + CI run ingestion via the gh CLI
    shellEnv.ts              resolve PATH and shell env for child processes
    fs.ts / git.ts           sandboxed filesystem + git bridges
  preload/                   contextBridge → typed window.cth API
  renderer/src/
    App.tsx                  top-level layout + wiring
    design/                  tokens.css / tokens.ts / global.css (design source of truth)
    components/              PixelPanel, AgentDetailPanel, CommandBar, ApprovalsPanel, MemoryPanel, …
    CommandCenterPanel,      Michael's control surface (Terminal/Floor/Memory/Activity/Tasks/Triggers/Handbook tabs)
    ToolWaterfall,           per-agent tool-span waterfall for the observability view
    TasksKanban,             dependency-aware kanban board (Tasks tab)
    ThreadsPanel,            hive message conversation viewer (Messages tab)
    MessageQueueComposer,    park messages for a busy agent
    scene/office/            Pixi office floor: OfficeFloor, Character, Camera, cast, pathfinding, …
    store/ · hooks/          zustand store, event loop, PTY parser, typewriter
    assets/                  tilesets, maps, character sheets (see ATTRIBUTION.md)
docs/                        OFFICE-X project page, brand assets, and documentation
landing-remotion/            Remotion project that renders the landing page's "how it works" clips
HIVE.md · SPEC.md · DESIGN.md   multi-agent · terminal/event · visual design
docs/message-queue.md        who may type into an agent's terminal, and when
```

<div align="right">(<a href="#architecture-project-structure-and-design-system">↑ back to top</a>)</div>

## Design system

The aesthetic is **Animal Crossing × Earthbound × SNES menu UI** — pixel-snapped, chunky, friendly.
[`DESIGN.md`](../DESIGN.md) documents the inherited pixel-office design system. The OFFICE-X
application mark is retained in the app chrome; OQVIAN is the company brand and is shown separately
in company-facing surfaces. Shared Office adds connection and trust controls without replacing the
local office floor. Preserve upstream art, code, and contributor attribution as described in
[`ATTRIBUTION.md`](../src/renderer/src/assets/ATTRIBUTION.md).
