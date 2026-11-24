# Final Performance, Stutter, Rendering & Stability Audit

**Date:** 2026-11-24 · **Type:** AUDIT ONLY — no source files were modified.
**Tree integrity:** `git status` and MD5 hashes of `server.js`, all HTML, all JS chunks and the WASM
were snapshotted before and after. **Identical.** The audit changed nothing.

---

## 1. Overall health assessment

**The site is structurally sound and the black-screen recovery holds.** The recovered mount boots
cleanly, hydrates without mismatch, issues 147 draw calls, and removes both the intro curtain and
the loader. Security and routing corrections are fully intact. The resource-eviction system is
well-designed and correctly implemented.

**The one thing this audit cannot do is measure frame performance.** There is no browser binary on
disk, no GPU (`/dev/dri` absent), and every browser CDN is egress-blocked. **FPS, frame-time
distribution, dropped frames, input latency and visual frame inspection are NOT MEASURED.** Nothing
below invents them. Everything else — WebGL pipeline, memory lifecycle, interaction guards,
responsive geometry, security — was verified by direct code extraction and runtime instrumentation.

**No CRITICAL defects found.** Two HIGH findings (one is the measurement limitation itself, one is a
responsive characteristic inherited from the original design). The rest are MEDIUM/LOW.

---

## 2. Actual browser and GPU environment

| Item | Value |
|---|---|
| Browser | **NONE** — no Chromium, Chrome, Firefox or headless shell on disk |
| GPU | **NONE** — `/dev/dri` absent, no NVIDIA device, `glxinfo` not installed |
| Browser CDN reachability | `cdn.playwright.dev` 000 · `storage.googleapis.com` 000 · `playwright.azureedge.net` 000 (all blocked) |
| CPU / RAM | 2 cores · 3939 MB (3510 MB available) |
| Runtime used instead | Node + jsdom + fake WebGL2 context (real bundle, instrumented) |
| Renderer string | **NOT MEASURED** — no real GL context exists here |

> **SwiftShader was not used** (no browser at all). No FPS number in this report comes from software
> rendering, because no rendering happened. The jsdom harness proves DOM, hydration, boot order,
> texture loading and draw-call *issuance* — it has no layout (canvas reports 0×0) and a fake GL
> context where every shader compiles and every draw succeeds.

---

## 3. FPS and frame-time measurements

**NOT MEASURED.** No browser, no GPU, no way to install one. I will not fabricate a frame-time
histogram.

What *can* be stated from the code (all VERIFIED by extraction):

- The render loop is **rAF-driven at display rate** (`requestAnimationFrame(v)` → emits `tick` →
  `this.tick`). There is no fixed-timestep cap and no FPS limiter.
- Frame delta is **clamped to 1/20 s (50 ms)**: `Math.min(this.timer.getDelta(),1/20)`. A longer
  stall is treated as 50 ms, so physics/animation never explodes after a hitch — but see §4.3.
- **Idle frame-skipping exists.** Class `FU` computes an FNV-1a hash over the scene graph (children
  counts, texture ids/versions, colors, positions). If the digest is unchanged and nothing forced a
  wake, `tick()` returns before rendering. `wake()` forces a frame; video frames wake via
  `requestVideoFrameCallback`. So a static gallery costs ~0 GPU work per frame while the JS loop
  still runs.
- **GSAP is configured `autoSleep:!1`** and **`lagSmoothing(0)`** — see §4.

---

## 4. Identified stuttering and performance bottlenecks

### 4.1 [HIGH] Frame performance is unverified — VERIFIED limitation

No browser/GPU exists in this environment, so the twelve scenarios in the brief (initial load,
gallery animation, card movement, fast cursor, cursor trail, project open/close, project-to-project,
FullIndex, sheet scrolling, horizontal dragging, floor reflections, post-processing) **cannot be
timed**. The boot chain and draw-call issuance are proven (§5), but whether the gallery holds 60 fps
on a real GPU, and where stutter actually occurs, is **UNVERIFIED**. This must be measured on the
user's machine before the portfolio adaptation.

### 4.2 [MEDIUM] Up to five scene submissions per frame — VERIFIED

`tick()` can issue, in one frame:

| # | Submission | When |
|---|---|---|
| 1 | scene → `reflectTarget` (0.1× res) | `reflectOn` (not small, card connected, alpha > 0.01) |
| 2 | scene → `post.target` (or canvas) | always (when not idle-skipped) |
| 3 | wipe render | during a wipe transition |
| 4 | post fullscreen quad → canvas | `post.active` (cursor lens) |
| 5 | `over` scene → canvas | always |

The reflection is cheap (0.1× resolution, `N0=.1`, layer `CS=1`). The dominant cost is the scene
itself (147 draw calls in the harness) rendered **twice** when reflection is on. On an integrated
GPU this is the main frame cost. It is gated correctly (`reflectOn` requires `!small`), so phones
skip it entirely.

### 4.3 [MEDIUM] GSAP lag smoothing disabled — VERIFIED

`fe.ticker.lagSmoothing(0)`. GSAP's default smooths over long frames (animations slow down briefly
instead of jumping). With smoothing off, **after any long frame — GC pause, texture upload, shader
compile — tweens jump forward to catch up**, which reads as a visible jump rather than a brief
slowdown. Combined with the 50 ms delta clamp, a 200 ms stall becomes a 50 ms step. This is a
deliberate choice (avoids slow-motion), but it is the most likely source of *perceived* stutter
under load. **Recommended:** leave as-is unless stutter is observed; if observed, this is the first
knob.

### 4.4 [MEDIUM] The JS loop never sleeps — VERIFIED

`fe.config({autoSleep:!1})` plus a permanent rAF loop. The app's own idle-skip prevents GPU work
when the scene is static, but the main thread wakes at display rate indefinitely. Battery cost on
laptops. The idle hash does mean a static page is cheap, so this is a minor concern.

### 4.5 [LOW] Touch move events are unthrottled — LIKELY minor

`touchmove` emits a `vs` (virtual scroll) event on **every** move event with no coalescing. On
high-frequency touch hardware (120–240 Hz) this floods the gallery velocity accumulator. It is
mitigated because events only accumulate into a velocity that is drained once per frame, so the cost
is bounded — but the per-event work (object allocation for the event payload) is wasted. Not a
stutter source in practice.

### 4.6 [LOW] No framebuffer-completeness check — LIKELY minor

`checkFramebufferStatus` appears **0 times**. If a render-target allocation fails (e.g. a very large
DPR on a 4K display exceeding `MAX_TEXTURE_SIZE`), three.js renders to an incomplete FBO and the
result is a black or garbage frame with no diagnostic. The reflection target is 0.1× so it is safe;
`post.target` is full-size. **Recommended:** add a one-time `checkFramebufferStatus` assertion after
`post.resize()`.

### 4.7 [INFORMATIONAL] No GPU timing instrumentation

`EXT_disjoint_timer_query` appears 0 times. There is no way for the app to measure its own GPU
frame cost. Fine for production; relevant only if you want self-diagnostics.

---

## 5. WebGL rendering findings

### 5.1 Renderer configuration — VERIFIED

```js
new dU({antialias:!0, alpha:!0, powerPreference:"high-performance"})
renderer.autoClear = !1
renderer.outputColorSpace = bo
renderer.setClearColor(0, 1)            // transparent clear
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))   // DPR capped at 2
```

- `powerPreference:"high-performance"` — requests the discrete GPU. Correct.
- `antialias:!0` + `alpha:!0` — MSAA on the default framebuffer, transparent canvas composited
  over the DOM (by design: DOM text sits over WebGL).
- **DPR capped at 2** — good balance of sharpness vs fill cost.
- `preserveDrawingBuffer` is **not set** → defaults `false`. Correct (no perf penalty).
- `autoClear:!1` — manual clear management. Correct for the multi-pass pipeline.

### 5.2 Shader compilation — VERIFIED good

At mount, before the first visible frame:

```js
renderer.compile(this.post.scene, this.post.camera)
renderer.compile(this.post.trailScene, this.post.camera)
renderer.compile(this.wipe.scene, this.wipe.camera)
```

wrapped in `try{...}catch{}`. **Shaders are pre-compiled**, so the first frame does not hitch on
program compilation. 44 fragment shaders / 16 `ShaderMaterial`s / 14 `MeshStandardMaterial` /
5 `MeshPhysicalMaterial` — a substantial custom shader surface, all warmed up front.

### 5.3 Post-processing pipeline — VERIFIED

Class `gU` (custom, **no `EffectComposer`** — 0 occurrences):

- `post.target` — full-screen RT, RGBA8, depth, no stencil, linear filtering.
- Fullscreen quad shader with the cursor-lens uniforms: `u_radius .2`, `u_lens 1.5`, `u_reach .16`,
  `u_orbit .35`, `u_wave .025`, `u_aberr .004` (channel split), `u_squash`, `u_breath`,
  `u_ballA`, `u_ballWarp .1`, `u_ballShade 1.2`, `u_ballEdge`, `u_trail`, `u_trailTexel`.
- **Cursor trail:** 2 ping-pong HalfFloat RTs (`ts×ts`) + `trailMaterial` (height-field paint with
  `u_decay`, `u_diff`, `u_pos`, `u_amp`, `u_rad .025`, `u_aspect`). `step()` paints only when
  `trailOn`.
- The lens shader is a **gravitational-lensing** model (Einstein ring, discs, sheets, frame
  dragging) — the comments describe it as an honest deflection map. This is the single most
  expensive fragment shader on the page and it runs over the **full screen** whenever the cursor is
  active.

> **UNVERIFIED risk:** the trail RTs are HalfFloat (`type:ys`) with no capability check. If
> `EXT_color_buffer_half_float` is unavailable, the trail render target may be incomplete and the
> cursor trail silently fails. The transmission RT *does* check
> (`EXT_color_buffer_half_float || EXT_color_buffer_float`); the trail does not. Needs a real GPU
> to confirm. **Recommended:** mirror the transmission check for the trail RTs.

### 5.4 Floor reflection — VERIFIED

Planar reflection: `reflectCamera` (layer `CS=1`) renders the scene into `reflectTarget` at
**0.1× drawing-buffer resolution** (`N0=.1`), created once and reused. Gated by
`reflectOn = !small && card.isConnected && u_alpha > .01`. `ground.visible = !small`. So the
reflection and the floor itself are **both disabled at ≤649 px** — the mobile path does no
reflection work at all. Sound.

### 5.5 Lighting — VERIFIED present

`MeshStandardMaterial` ×14 and `MeshPhysicalMaterial` ×5 (PBR). `anisotropy` is set on textures
(120 references) capped by `getMaxAnisotropy()`. Light *class* references in the bundle
(`SpotLight` 47, `PointLight` 33, `DirectionalLight` 19, `RectAreaLight` 10) include three.js
internals, so instance counts cannot be derived statically — **UNVERIFIED** how many lights are
actually in the scene. If the count is high, forward-rendering cost scales with it. Worth checking
in a real browser via `renderer.info`.

### 5.6 Context loss — LIKELY OK

three.js registers `webglcontextlost` / `webglcontextrestored` / `webglcontextcreationerror`
handlers and re-initialises GL state on restore (textures re-upload via version tracking). The app
adds **no custom recovery**, but none is required — three.js handles it. `forceContextLoss` /
`forceContextRestore` appear once each (three.js `WEBGL_lose_context` plumbing). No app-level
context-loss UI exists, so a *permanent* loss shows a frozen/black canvas with no message.
**Recommended:** add a `webglcontextlost` listener that shows a "GPU context lost — reload" notice.

### 5.7 Runtime WebGL errors — VERIFIED silent

`window.onerror` **0**, `unhandledrejection` **0**. There is **no global error reporting**. A
runtime exception in the render loop would leave a frozen frame with nothing in the console beyond
the browser's own report. **Recommended:** add a minimal `window.addEventListener('error')` /
`unhandledrejection` handler that at least logs to `console.error` (or a reporting endpoint).

### 5.8 Recovered mount — VERIFIED still working

Harness re-run on the current tree (image-loader stub only, app logic untouched):

```
drawElements: 147   canvas count: 1
curtain still present: false   CURTAIN (.z-99): 0   LOADER: 0
```

Boot chain (from the previous phase, unchanged): `i.mount()` → `i.boot() n=23` → curtain off →
23/23 textures → `bootRelease()` → loader off → complete. **The recovery holds.**

---

## 6. Memory and resource lifecycle results

### 6.1 Structure — VERIFIED

Class `jB` (texture/video manager):

| Store | Type | Purpose | Evicted? |
|---|---|---|---|
| `this.cache` | `Map<url, Promise<Texture>>` | in-flight + resolved promises | yes (on release) |
| `this.resolved` | `Map<url, Texture>` | live GPU textures | yes |
| `this.videos` | `Map<url, {el, texture, playing}>` | video elements + textures | yes |
| `this.items` | `Map` | **project catalogue records** | **NEVER** ✓ |
| `this.texStamp` | `Map<url, timestamp>` | last-used stamp | yes |

### 6.2 Eviction — VERIFIED sound

```js
this._evict = setInterval(() => this.evictStale(), 15e3)   // every 15 s
evictStale(): MAXT=64, MAXV=16
  non-live, age > 8 s   → releaseTexture (dispose only)
  non-live, age > 60 s  → releaseTexture + ImageBitmap.close()
  over cap              → oldest-first, live skipped
  videos: playing or live → never evicted
```

- **Live textures are never disposed.** `liveTextures()` collects from 12 containers
  (`content`, `page`, `overlay`, `texts`, `hud`, `pills`, `rings`, `awards`, `leaving`, `cards`,
  `blastRows`, `flights`) + `rail.items` + `reg.all()` + `hero`/`pendingTitle`/`titleHero`/
  `titleFly` (+ their `.plane`s), using generic texture detection (`isTexture` or
  `dispose`+`image`). This correctly handles the `{mesh}`-wrapper and raw-mesh shapes.
- **Evicted resources reload correctly.** `releaseTexture` deletes from `resolved`, `cache` and
  `texStamp`, so the next `texture(url)` call creates a fresh load. In-flight loads live in `cache`
  (not `resolved`) and are never touched by eviction.
- **Shared resources stay available.** A texture referenced by any live object is in the live set
  and skipped.
- **Catalogue records are never treated as media.** `this.items` is not iterated by eviction. ✓
- **Videos:** `releaseVideo` pauses, removes `src`, calls `load()`, disposes the texture, removes
  the element, deletes from the map. Playing videos are skipped. `watchTab` pauses/resumes on
  `visibilitychange`; `playVideo` respects `document.hidden`.
- **ImageBitmap lifecycle:** `close()` is called only past the 60 s threshold, and only for
  non-live textures. Correct — closing a bitmap still referenced by a live texture would blank it.

### 6.3 Findings

- **[LOW] `ready()` cache-hit does not refresh the stamp.** `ready(e,t)` returns a resolved texture
  without `texStamp.set`. A texture accessed *only* via `ready()` never refreshes its age. In
  practice `texture()`/`preload()` stamp on every load, and live textures are protected anyway, so
  the practical effect is nil. **INFORMATIONAL.**
- **[LOW] Video `play` listener + rVFC chain are not removed on release.** `releaseVideo` does not
  `removeEventListener('play', ...)`. The element is detached and unreferenced after
  `videos.delete(e)`, so the listener→manager reference cycle is collectable. Not a leak.
  **INFORMATIONAL.**
- **[LOW] Cap cannot be enforced if everything is live.** If more than 64 textures are
  simultaneously live, `resolved.size` stays above `MAXT` by design. With 23 projects × ~3
  textures, this is only reachable if the whole catalogue is on screen at once.
  **INFORMATIONAL.**
- **Memory stabilisation across repeated navigation: UNVERIFIED.** The eviction logic is correct by
  inspection, but proving that texture/video counts plateau requires repeated real navigation with
  `performance.memory` / `renderer.info.memory` — impossible here. The 15 s interval + 8 s floor
  means a texture used in a burst survives at least one eviction pass.

---

## 7. Interaction stress-test results

**Cannot be executed without a browser.** Static analysis of every input path:

| Scenario | Mechanism | Verdict |
|---|---|---|
| Rapid open/close | GSAP `overwrite:"auto"` on `fade`, `swap`, pill tweens; `fe.killTweensOf` before new tweens | **LIKELY safe** |
| Switch before settle | competing tweens are killed, not queued | **LIKELY safe** |
| Input during transition | `$scroll.stop()` sets lock + clears momentum; `$scroll.start()` releases | **VERIFIED present** |
| Drag release outside viewport | `touchcancel` handler resets drag state, no flick | **VERIFIED present** |
| Pointer leaves window | `pointerleave` on `documentElement` hides cursor ball (`relatedTarget` check) | **VERIFIED present** |
| Tab switch | `visibilitychange` pauses videos; GSAP has its own visibility handler | **VERIFIED present** |
| Resize during animation | resize debounced 100 ms, emits `resize`, `$resize.add(this.resize)` re-sizes renderer + post + wipe | **VERIFIED present** |
| Featured ↔ Full switch | `indexCut` picks `src` (featured) vs `thumb\|\|src` (non-featured); `preloadThumbs` 2 workers | **VERIFIED present** |
| Browser back/forward | Nuxt router `popstate` (2 refs); scroll restoration on `visibilitychange` | **VERIFIED present** |
| Reopen after eviction | evicted URL re-loads on next `texture()` | **VERIFIED by code** |
| Keyboard | arrows ±100 px, PageUp/Down ±0.9×viewport, space; ignored in inputs/modifiers | **VERIFIED present** |
| Pinch-zoom | `wheel` handler returns early on `ctrlKey` | **VERIFIED present** |

**Notable absences (INFORMATIONAL):**
- **No mouse drag at all.** There are **0** `mousedown`/`mouseup`/`mousemove` handlers. Gallery
  navigation is `wheel` + `touch` + `keyboard` only. "Drag release outside viewport" is therefore
  only applicable to touch, where `touchcancel` covers it. **There is no mouse-drag stuck state to
  find.**
- **No app-level transition lock** (`busy` appears only in the dead Newsletter form components).
  Rapid interaction safety rests entirely on GSAP `overwrite:"auto"`, which is the correct tool —
  but it means a pathological rapid sequence produces tween churn, not a hard block.
- **No `prefers-reduced-motion`** (0 occurrences). Vestibular accessibility gap.
  **Recommended:** honour it by shortening/disabling the lens warp and gallery inertia.

---

## 8. Visual defects

**Cannot be inspected** — no browser, no screenshots possible. The following is code-level only.

### 8.1 Previously corrected bugs — regression check (all VERIFIED still resolved)

| Bug | Evidence it remains resolved |
|---|---|
| Panel scrim handoff | `veil` mesh + `veilOut` flag + `syncEnv()` scrim logic present |
| Title/body reveal | DOM present; `titleHero`/`titleFly`/`pendingTitle` in `liveTextures()` |
| Project-sheet clipping | `u_clip` / `u_clipR` / `u_clipOn` uniforms present in post shader |
| Seam-bulge alignment | `u_bulgeH` uniform + bulge geometry present |
| Cursor trail | trail pipeline (`trail` RTs, `trailMaterial`, `trailScene`, `step()`) present |
| Description rendering | all 8 project pages contain descriptions |
| Floor reflection | `reflectTarget`/`reflectCamera`/`reflectOn` present |
| Homepage restoration | 8 `article[data-gl=card]`, boot verified, 147 draw calls |
| Newsletter removal | **0** `Newsletter`, **0** `/newsletter`, **0** `<form>`, **0** `api/subscribe` in HTML |
| Black-screen recovery | harness: curtain 0, loader 0, canvas 1, hydration clean |

### 8.2 DOM/CSS state — VERIFIED

- `article[data-gl=card]` ×8, `div[data-gl=bar]` ×3, `span[data-gl=text]` ×6, `data-gl-shield` ×1,
  8 `/projects/` links.
- `.gl{inset:0;pointer-events:none;position:fixed;z-index:10}` — canvas layer correct.
- `.gl canvas{inset:0;position:absolute}` — correct.
- `html{height:100%;max-height:100%;min-height:100%;overflow:hidden;position:fixed;touch-action:none;width:100%}` —
  fixed-viewport app shell, touch-action none (prevents pull-to-refresh/scroll chaining).
- Canvas is **not** in the prerendered HTML (0 `<canvas>`) — inserted at mount. Correct.

### 8.3 Things that cannot be ruled out without a browser

Flickering, opacity jumps, shadow correctness, text overlap, clipping errors, image distortion,
colour accuracy, layering, layout shift, one-frame flashes, missing elements. **All UNVERIFIED.**
The DOM and CSS are structurally correct, which rules out *gross* defects, but not visual ones.

---

## 9. Responsive results

### 9.1 Root typography — VERIFIED by computation

Rule (all 10 pages): `html{font-size:clamp(5px,20px,max(0.66667vw,min(2.5641vw,33.7683px - 2.63102vw)))}`

| Width | 0.667vw | 2.564vw | 33.77−2.63vw | **root font-size** |
|---|---|---|---|---|
| 320 | 2.13 | 8.21 | 25.35 | **8.21 px** |
| 360 | 2.40 | 9.23 | 24.30 | **9.23 px** |
| 390 | 2.60 | 10.00 | 23.51 | **10.00 px** |
| 430 | 2.87 | 11.03 | 22.45 | **11.03 px** |
| 649 | 4.33 | 16.64 | 16.69 | **16.64 px** |
| **650** | 4.33 | 16.67 | 16.67 | **16.67 px ← peak** |
| 651 | 4.34 | 16.69 | 16.64 | **16.64 px** |
| 768 | 5.12 | 19.69 | 13.56 | **13.56 px** |
| 1024 | 6.83 | 26.26 | 6.83 | **6.83 px** |
| 1280 | 8.53 | 32.82 | 0.09 | **8.53 px** |
| 1440 | 9.60 | 36.92 | −4.12 | **9.60 px** |
| 1920 | 12.80 | 49.23 | −16.75 | **12.80 px** |
| 2560 | 17.07 | 65.64 | −33.59 | **17.07 px** |

### 9.2 [HIGH] The root font peaks at 650 px, then falls 2.4× by 1024 px — VERIFIED

The two inner lines cross at exactly 650 px (`2.5641vw = 33.7683px − 2.63102vw` → `vw = 6.5px`).
Below 650 px the font grows with width; above 650 px it **shrinks** until 1500 px, then grows again.
Consequences:

- A 768 px tablet (iPad portrait) gets root **13.56 px**; a 1024 px screen (iPad landscape / small
  laptop) gets **6.83 px** — everything sized in `rem` appears **~2× smaller** on the *larger* screen.
- The `small` breakpoint is `clientWidth <= 649`, so at 650 px the layout flips to "large" (floor +
  reflection on) at the exact moment the root font is at its maximum.
- This is the **original site's formula** and was deliberately preserved. It is not a defect
  introduced by any fix. But it is the single most surprising responsive characteristic of the site
  and will directly affect your portfolio adaptation: **do not assume `rem` scales monotonically
  with viewport width.**

### 9.3 Breakpoint behaviour — VERIFIED

- `small = clientWidth <= 649` (resize handler, debounced 100 ms).
- `ground.visible = !small` and `reflectOn` requires `!small` → **floor and reflection are off at
  ≤649 px**, on at ≥650 px.
- `i.mouse = matchMedia("(hover: hover) and (pointer: fine)")` → cursor ball only on fine pointers.
- **Screenshots: NOT CAPTURED** (no browser). Card dimensions, project-sheet geometry, edge bounce
  and touch responsiveness are **UNVERIFIED** visually.

---

## 10. Security and routing verification

All re-tested against the live server this audit. **Everything intact.**

| Check | Result |
|---|---|
| Traversal + encoded traversal, **37 payloads** | **0 leaks, 0 unexpected statuses** (400/403/404 only) |
| Private file exposure (`server.js`, `.git/`, `.env`, `package.json`) | **0 leaks** |
| Directory listing | **none** — `/site_build/`, `/_nuxt/`, `/projects/` → 404; `/.git/` → 403 |
| Genuine 404s | `/nope`, `/newsletter`, `/projects/`, `/api/subscribe`, `/api/`, `/llms.txt`, `/robots.txt`, `/sitemap.xml` → **404** |
| Newsletter endpoint | `/newsletter` → **404**, body contains **0** newsletter strings |
| App routes | `/`, `/full`, 8 project pages → **200** |
| Asset delivery | **all 36 assets byte-identical** to disk (MD5 compared) |
| MIME correctness | JS → `application/javascript`, WASM → `application/wasm`, font → `font/woff2` |
| HTML-in-place-of-JS | **none** — missing `.js`/`.wasm` return 404, not HTML |
| Methods | GET/HEAD → 200; POST/PUT/DELETE/PATCH/OPTIONS/TRACE → **405** with `Allow: GET, HEAD` |
| Cache headers | `Cache-Control: no-store, max-age=0`, `Pragma: no-cache`, `Expires: 0` on **all** asset types |
| Security headers | `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` |
| SPA fallback | **not restored** — unknown paths are genuine 404s |

**Missing headers (INFORMATIONAL):** no `Content-Security-Policy`, no `X-Frame-Options` /
`frame-ancestors`, no `Strict-Transport-Security` (the last is only meaningful over HTTPS and is
normally set by the terminating proxy). For a static portfolio this is acceptable, but a CSP would
harden it. **Not a regression** — these were never present.

---

## 11. Previously corrected bug regression results

| Fix | Status |
|---|---|
| Path-traversal containment | **INTACT** (37/37 payloads) |
| Genuine 404s, no SPA fallback | **INTACT** |
| 650 px fluid root sizing | **INTACT** (10/10 pages) |
| Liveness-based eviction + corrected `liveTextures()` | **INTACT** |
| KTX2 / manifest / award-model fallbacks | **INTACT** (`ktx2()`→`null`, `manifest()`→`{}`, `SF=null`) |
| Newsletter removal | **INTACT** (0 rendering occurrences) |
| All 23 project records | **INTACT** |
| Original WebGL engine, shaders, GSAP timelines | **INTACT** (untouched) |
| Black-screen recovery (`return Rn` + hydration fix) | **INTACT** (harness re-verified) |
| Cache headers | **INTACT** |

---

## 12. Remaining limitations

1. **Frame performance is NOT MEASURED.** No browser, no GPU. FPS, frame-time percentiles, dropped
   frames, long frames, input latency, main-thread blocking and rendering interruptions are all
   unknown. **This is the largest gap in this audit.**
2. **No rendered frame has ever been inspected.** Visual defects (flicker, clipping, colour,
   layering, layout shift) are UNVERIFIED. DOM/CSS structure is correct, which rules out gross
   defects only.
3. **Memory stabilisation is UNVERIFIED** over repeated real navigation. Eviction logic is correct
   by inspection; plateau behaviour needs `performance.memory` / `renderer.info.memory` in a browser.
4. **Light count in the scene is UNVERIFIED** (bundle counts include three.js internals).
5. **HalfFloat trail RT support is UNVERIFIED** on real hardware.
6. **No screenshots** at any of the 13 viewport widths.
7. External media (Mux images/video, DatoCMS) could not be validated — those hosts are
   egress-blocked from this sandbox. If a texture URL is dead, the loader resolves `null` and the
   card renders blank. **This is a real risk that cannot be checked here.**

---

## 13. Findings register

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **HIGH** | Frame performance NOT MEASURED (no browser/GPU) | VERIFIED limitation |
| 2 | **HIGH** | Root font peaks at 650 px then falls 2.4× to 1024 px | VERIFIED |
| 3 | MEDIUM | Up to 5 scene submissions/frame; scene rendered twice with reflection | VERIFIED |
| 4 | MEDIUM | GSAP `lagSmoothing(0)` — tweens jump after long frames | VERIFIED |
| 5 | MEDIUM | GSAP `autoSleep:!1` + permanent rAF — main thread never idle | VERIFIED |
| 6 | MEDIUM | No `prefers-reduced-motion` support | VERIFIED |
| 7 | MEDIUM | No global error handler (`onerror`/`unhandledrejection` = 0) | VERIFIED |
| 8 | MEDIUM | No context-loss UI (three.js recovers GL state, app shows nothing) | VERIFIED |
| 9 | LOW | Trail RTs are HalfFloat with no capability check | UNVERIFIED |
| 10 | LOW | No `checkFramebufferStatus` on full-size post target | LIKELY |
| 11 | LOW | Touch `touchmove` unthrottled | LIKELY |
| 12 | LOW | `ready()` cache-hit doesn't refresh `texStamp` | VERIFIED (benign) |
| 13 | LOW | Video `play` listener not removed on release | VERIFIED (benign) |
| 14 | LOW | Eviction cap unenforceable if >64 textures live | VERIFIED (by design) |
| 15 | INFORMATIONAL | No mouse-drag input (wheel/touch/keyboard only) | VERIFIED |
| 16 | INFORMATIONAL | No CSP / frame-ancestors headers | VERIFIED |
| 17 | INFORMATIONAL | No GPU timing instrumentation | VERIFIED |
| 18 | INFORMATIONAL | External media validity untestable from sandbox | VERIFIED limitation |

**No CRITICAL findings. Nothing in this audit requires a fix before you adapt the site** — but
findings 1 and 2 should be understood first: you cannot confirm smoothness without a real browser,
and the `rem` scale is not monotonic.

---

*Audit performed without modifying any source file. Working tree verified identical before and after.*
