# Bug, Performance & Stability Audit

**Repository:** `sausageOps/httpsjesperlandberg.com`
**Branch:** `arena/a8cee66f-httpsjesperlandberg-com` (base `e27248e`)
**Reference:** https://jesperlandberg.com/
**Date:** 2026-11-24
**Mode:** AUDIT ONLY — no source files modified, no dependencies installed, no commits. Only this report was created.

---

## 0. Testing Environment and Measurement Limitations — READ FIRST

This section is mandatory because it bounds every claim in this document.

### What the environment actually is

| Property | Value |
|---|---|
| Browser binaries available | **NONE** — no Chrome, Chromium, Firefox, or WebKit anywhere on the filesystem |
| GPU | **NONE** — no `/dev/dri`, no hardware rendering device |
| CPU | 2 cores |
| RAM | 3.9 GB |
| Browser CDN egress | **BLOCKED** — `cdn.playwright.dev`, `playwright.azureedge.net`, `storage.googleapis.com`, `dl.google.com`, `deb.debian.org`, `archive.ubuntu.com` all unreachable |
| Reachable hosts | `github.com`, `api.github.com`, `registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org` only |
| Media CDN egress | **BLOCKED** — `datocms-assets.com`, `image.mux.com`, `stream.mux.com` unreachable |

**No browser could be obtained** (every browser binary CDN is blocked) **and no GPU exists**. The audit rules prohibited installing dependencies.

### Therefore

> **No FPS, frame-time, frame-drop, input-latency, or runtime heap measurement in this report is fabricated. They were not measured, because they cannot be measured in this environment.**

Everything in §3 (Performance) is labelled one of:
- **CONFIRMED (measured)** — obtained by direct HTTP probe or byte-level file inspection in this environment.
- **CONFIRMED (computed)** — derived arithmetically from constants actually present in the shipped CSS/JS/payload, with the formula shown so you can re-derive it.
- **LIKELY** — strong code evidence, requires a browser to confirm.
- **UNVERIFIED** — cannot be determined here.

No SwiftShader was used, because no browser ran at all. Nothing here is software-rendered FPS presented as GPU FPS — there is no FPS at all.

### What you must re-run in a real browser before shipping

The following phases require a GPU and a browser and are **entirely unexecuted**: FPS/frame-time profiling (Phase 1), WebGL runtime inspection (Phase 2 runtime half), interaction stress-testing (Phase 3), visual frame inspection (Phase 4), media playback (Phase 5 runtime half), heap/DOM/GPU-resource growth over cycles (Phase 6), rendered responsive testing (Phase 7), and console-error capture (Phase 8). A ready-to-run protocol is provided in §11.

---

## 1. Performance Summary

### 1.1 Measured in this environment (CONFIRMED)

These are real numbers, obtained by probing the running server and measuring shipped bytes.

| Metric | Value | How measured |
|---|---|---|
| Homepage HTML | 38,690 B | `curl` |
| Main JS chunk | 1,145,555 B (1.09 MB) | file size |
| WASM transcoder | 527,333 B (515 KB) | file size |
| Variable font | 115,148 B (112 KB) | file size |
| Payload | 48,768 B | file size |
| Largest JS chunk (uncompressed, no HTTP compression on `server.js`) | 1.09 MB | `server.js` sends no `Content-Encoding` |
| **Total JS parse/compile surface** | **≈1.2 MB** | sum of `_nuxt/*.js` |
| Distinct JS chunks | 12 | directory listing |
| Pre-rendered pages | 11 | verified |
| HTTP compression | **NONE** | `server.js` sets no `Content-Encoding`; `curl` confirms identity encoding |
| Cache headers | **NONE** | no `Cache-Control`, no `ETag` |

> **Perf note (CONFIRMED):** `server.js` serves a 1.09 MB JavaScript file and a 515 KB WASM with **no gzip/brotli and no cache headers**. On any real host with compression, the main chunk would typically compress to roughly 250–350 KB. In this deployment every repeat visit re-downloads ~1.6 MB uncompressed. This is a deployment-configuration defect, not an application defect — but it is the single largest avoidable load cost found.

### 1.2 Render-target budget (CONFIRMED — computed from shipped constants)

Constants recovered from the bundle: `setPixelRatio(Math.min(2, window.devicePixelRatio))`, `ts = 256`, reflection scale `N0 = .1`.

| Viewport | Effective DPR | Main RT | Reflection (10%) | Trail (2×256²) | Total RT memory |
|---|---|---|---|---|---|
| 390×844 | 2 (capped from 3) | 5.0 MB | 0.05 MB | 0.50 MB | **5.6 MB** |
| 768×1024 | 2 | 12.0 MB | 0.12 MB | 0.50 MB | **12.6 MB** |
| 1280×800 | 2 | 15.6 MB | 0.16 MB | 0.50 MB | **16.3 MB** |
| 1920×1080 | 1 | 7.9 MB | 0.08 MB | 0.50 MB | **8.5 MB** |
| 1920×1080 | 2 | 31.6 MB | 0.32 MB | 0.50 MB | **32.5 MB** |
| 2560×1440 | 1 | 14.1 MB | 0.14 MB | 0.50 MB | **14.7 MB** |
| 3840×2160 | 1 | 31.6 MB | 0.32 MB | 0.50 MB | **32.5 MB** |

**Reading:** render targets are *not* the bottleneck. Worst case ~33 MB. The DPR cap at 2 is doing real work here — uncapped DPR 3 at 1920×1080 would be 71 MB for the main target alone.

### 1.3 Texture budget (CONFIRMED — computed from payload dimensions)

Recovered from `_payload.json`: 70 unique media URLs carrying declared intrinsic `width`/`height`, plus DatoCMS `w=`/`h=` query caps.

| Scope | Images | Delivered pixels | RGBA8 | + mipmaps | BC7/ETC2 |
|---|---|---|---|---|---|
| All 23 projects | 70 | 83.3 MP | 317.8 MB | 423.6 MB | 105.9 MB |
| **8 featured projects (viewable)** | **28** | **30.2 MP** | **115.1 MB** | **153.4 MB** | **38.4 MB** |

Largest single delivered textures: 2048×1210, 2048×1204, 2048×1172, 2048×1114 (Mux thumbnails, ~9 MB each RGBA8).

**This — not render targets — is the dominant GPU cost.** If all 8 case studies are opened in one session, up to ~115–153 MB of texture memory is resident, and (see **H2**) it is never released.

### 1.4 Frame-rate and frame-time statistics

**NOT MEASURED — NO BROWSER AVAILABLE.** No average FPS, no frame-time distribution, no dropped-frame count, no long-frame count, no main-thread blocking duration, and no input-to-render latency can be honestly reported. See §0.

### 1.5 What the code proves about frame pacing (CONFIRMED — code inspection)

These are structural properties recovered from the shipped bundle, not measurements:

| Property | Evidence | Assessment |
|---|---|---|
| Frame delta clamped | `const e = Math.min(this.timer.getDelta(), 1/20)` | ✅ Prevents animation explosion after tab-switch / long frame |
| Idle rendering gated | `if(!this.idle.should(e)) return` | ✅ Skips redraw when nothing changed |
| Forced redraw interval | `const OU = .25` → `held >= OU` | ✅ Idle floor ≈ 4 fps, not 60 — battery-friendly |
| Change detection | `digest()` hashes camera quaternion, geometry ids/position versions, and every material uniform | ⚠️ Correct but runs **every frame** (see **M6**) |
| Shader warm-up at mount | `renderer.compile(post.scene…)`, `compile(post.trailScene…)`, `compile(wipe.scene…)` inside `try{}` | ✅ Mitigates first-frame shader-compile stall |
| `powerPreference` | `"high-performance"` | ✅ |
| DPR | `Math.min(2, devicePixelRatio)` | ✅ |
| Antialias | enabled (`antialias:!0`) | ⚠️ MSAA cost on mobile (see **M9**) |
| Resize throttling | handler debounced at `100` ms | ✅ No realloc storm during drag-resize |
| Trail targets | `ts = 256`, 2 targets, ping-pong | ✅ Trivially cheap (0.5 MB) |
| Reflection | shader floor plane + 10%-scale RT, gated by `reflectOn` | ✅ Cheap; not a second full-scene pass |
| Context loss | `webglcontextlost` / `webglcontextrestored` handlers present | ✅ |
| Tab visibility | `visibilitychange` pauses/resumes videos | ✅ |

**Honest conclusion on animation smoothness:** the *architecture* is unusually well-engineered for frame pacing — delta clamping, digest-based idle skipping, shader pre-compilation, DPR capping, throttled resize, and cheap trail/reflection targets are all deliberate, competent choices. I found **no structural reason to expect stuttering** in the render loop itself. The likely stutter sources are elsewhere: texture upload churn (**H2**), 15 retained video elements (**M5**), per-frame DOM scanning (**M4**), and per-frame uniform hashing (**M6**). Each needs a browser to quantify.

---

## 2. Findings — CRITICAL

### C1 — Path traversal in `server.js` exposes arbitrary files

| Field | Detail |
|---|---|
| **Severity** | CRITICAL (security) |
| **Status** | **CONFIRMED** — reproduced 4/4 payloads |
| **Description** | `path.join(PUBLIC_DIR, pathname)` is applied to a `decodeURIComponent`'d URL path with no containment check. Any file readable by the Node process outside `site_build/` can be downloaded. |
| **Reproduction** | `curl --path-as-is http://host:3000/../server.js` → `200`, 2351 B, returns the server's own source.<br>Also: `/..%2fserver.js`, `/_nuxt/../../server.js`, `/%2e%2e/server.js` — all `200` with the same payload. |
| **Affected components** | `server.js` request handler |
| **Relevant code** | `let pathname = decodeURIComponent(parsedUrl.pathname); let filePath = path.join(PUBLIC_DIR, pathname);` |
| **Measurement** | 4/4 traversal payloads returned `HTTP 200`, `Content-Type: text/html`, 2351 bytes — the full `server.js` source. |
| **Expected** | Requests outside `site_build/` → `403`/`404`. |
| **Observed** | Full file contents served. |
| **Root cause** | No `path.resolve` + prefix check (`if (!filePath.startsWith(PUBLIC_DIR + path.sep)) reject`). |
| **Recommended fix** | Resolve the path, then assert it is inside `PUBLIC_DIR`; reject otherwise. |
| **Regression risk** | Low. Legitimate deep links are unaffected. |
| **Note** | Per instruction, **not fixed** in this task. Remains a mandatory pre-deployment blocker. |

### C2 — Newsletter reports success while storing nothing

| Field | Detail |
|---|---|
| **Severity** | CRITICAL (silent data loss) |
| **Status** | **CONFIRMED** (HTTP behaviour) + **CONFIRMED** (success-branch logic read from bundle) |
| **Description** | The only write path on the site POSTs to `/api/subscribe`, which does not exist. The server returns the homepage with `HTTP 200`, so the client's success branch executes and shows "On the list. Talk soon." No email is recorded. |
| **Reproduction** | `curl -X POST -H 'Content-Type: application/json' -d '{"email":"a@b.com"}' http://host:3000/api/subscribe` → `200`, `Content-Type: text/html`, 38,690 B of homepage HTML. |
| **Affected components** | `Newsletter` component (`Gz`), `server.js` fallback |
| **Relevant code** | `const ie = await $fetch("/api/subscribe", {method:"POST", body:{email, company}}); D(ie?.pending ? "pending" : "subscribed");` |
| **Measurement** | Response: `200` + `text/html` + full HTML document. `ie?.pending` on an HTML string is `undefined` → falls to `"subscribed"`. |
| **Expected** | Either a real `200 {pending:…}` from a working endpoint, or a visible error. |
| **Observed** | False success message; zero data persisted. |
| **Root cause** | Nitro server routes were never captured in this static export, and `server.js`'s SPA fallback masks the absence with a `200`. |
| **Recommended fix** | Restore `/api/subscribe` as a serverless function; make the client validate `response._data` shape and surface failures loudly. |
| **Regression risk** | Low. |
| **Note** | Not fixed in this task. |

---

## 3. Findings — HIGH

### H1 — 650 px breakpoint collapses the entire UI scale by 70%

| Field | Detail |
|---|---|
| **Severity** | HIGH (responsive / visual) |
| **Status** | **CONFIRMED (computed)** — exact arithmetic from shipped CSS |
| **Description** | Root font size is `clamp(5px, 20px, 10 * 100vw / var(--size))` with `--size: 390` below 650 px and `--size: 1500` at ≥650 px. The two scales do not meet at the breakpoint, so crossing 650 px shrinks every `rem`-based dimension by ~70% instantly. |
| **Reproduction** | Resize the window from 649 px to 650 px wide. Everything shrinks ~3.3× in one frame. |
| **Affected components** | Global typography and all `rem`-based layout; `--size` custom property |
| **Relevant code** | `:root{--size:390}@media(min-width:650px){:root{--size:1500}}`<br>`html{font-size:clamp(5px,20px,10 * 100vw/var(--size))}`<br>`body{font-size:1.4rem}` |
| **Measurement** | 649 px → root 16.64 px, body **23.30 px**<br>650 px → root 5.00 px, body **7.00 px**<br>Ratio **0.300×** (70% collapse)<br>768 px (iPad portrait) → root 5.12 px, body **7.17 px**<br>1024 px → body **9.56 px**; 1280 px → **11.95 px** |
| **Expected** | Continuous scale across the breakpoint; readable body text on tablets. |
| **Observed** | Hard 3.3× discontinuity at 650 px; body text ~7 px across the whole 650–900 px range. |
| **Root cause** | `--size` swaps 390→1500 at 650 px, but `100vw/1500` at 650 px yields 4.33 px — far below the mobile curve's 16.64 px. The 5 px `clamp` floor then pins it. |
| **Recommended fix** | Choose a single `--size` per breakpoint such that `10*width/--size` is continuous at the boundary, or scale `--size` continuously rather than in two steps. |
| **Regression risk** | Medium — a global typographic change; verify every `rem`-based measurement and the WebGL text mirror afterwards. |
| **Caveat** | Derived from CSS arithmetic, not a rendered screenshot (no browser). The numbers are exact; the *visual* severity at each width needs a browser. |

### H2 — Texture, video and item caches never evict

| Field | Detail |
|---|---|
| **Severity** | HIGH (memory / resource leak) |
| **Status** | **CONFIRMED** — zero eviction calls found in the entire bundle |
| **Description** | The GL stage keeps four `Map`s for its lifetime: `cache`, `resolved`, `videos`, `items`. None of them ever call `.delete()` or `.clear()`. Every texture, `ImageBitmap`, and `<video>` element created while browsing is retained until full page unload. |
| **Reproduction** | Open all 8 project pages in one session, return to the homepage, then inspect heap / `document.querySelectorAll('video')`. |
| **Affected components** | `jB` (GL stage) — `this.cache`, `this.resolved`, `this.videos`, `this.items` |
| **Relevant code** | `this.cache=new Map, this.resolved=new Map, this.videos=new Map, this.items=new Map`<br>`video(e){ let t=this.videos.get(e); if(t) return t; … this.videos.set(e,t) … }` |
| **Measurement** | `this.cache.delete` = 0, `this.resolved.delete` = 0, `this.videos.delete` = 0, `this.items.delete` = 0, `.clear()` = 0 across the whole 1.09 MB bundle.<br>Bounded **today** by content: 28 featured images (≈115 MB RGBA8), 15 video streams.<br>**Unbounded once you add your own projects.** |
| **Expected** | LRU eviction or per-route teardown releasing textures/videos when a project closes. |
| **Observed** | Append-only for the app lifetime. Plane disposal frees GPU textures but the JS-side `ImageBitmap`/`Texture` references stay pinned in the Maps. |
| **Root cause** | Cache-as-registry design with no invalidation path. |
| **Recommended fix** | Add reference-counted eviction: when a plane is dropped and its texture refcount hits 0, `.delete()` the cache entry and dispose the `ImageBitmap`. Same for video elements on route leave. |
| **Regression risk** | Medium — over-eager eviction would cause texture re-upload flicker; needs refcounting, not naive clearing. |
| **Why HIGH for your use case** | Your stated goal is replacing content with your own. With more projects this becomes a genuine unbounded leak rather than a bounded 115 MB. |

### H3 — Three hardcoded asset paths are missing and fail silently

| Field | Detail |
|---|---|
| **Severity** | HIGH (missing content, silent degradation) |
| **Status** | **CONFIRMED** — all three probed, all absent on disk, all return homepage HTML |
| **Description** | Three runtime asset paths are hardcoded to locations that do not exist in `site_build/`. Because `server.js` soft-404s to the homepage with `200`, each failure is swallowed by a `.catch()` and the site silently substitutes a worse result. |
| **Reproduction** | `curl http://host:3000/basis/`, `/textures/manifest.json`, `/models/award.glb` → all `200 text/html` 38,690 B. |
| **Affected components** | KTX2 loader, texture manifest, award 3D model |
| **Relevant code** | `.setTranscoderPath("/basis/")`<br>`fetch("/textures/manifest.json").then(e=>e.ok?e.json():{}).catch(()=>({}))`<br>`const SF="/models/award.glb"; … try{ … }catch{} n||(n=new rg(.4,1,6))` |
| **Measurement** | `/basis/` absent → KTX2 transcoder receives HTML → `catch(()=>null)` → **KTX2 permanently disabled**.<br>`/textures/manifest.json` → HTML with `200` → `e.ok === true` → `e.json()` throws → `catch` → **manifest is `{}`**.<br>`/models/award.glb` → HTML with `200` → GLTF parse fails → `catch{}` → **fallback primitive** `rg(.4,1,6)`. |
| **Expected** | Real assets served at those paths. |
| **Observed** | Silent fallbacks: no compressed textures, empty texture manifest, and **award medals rendered as a generic procedural primitive instead of the real 3D models**. |
| **Root cause** | Static export omitted these directories; the server's homepage fallback converts a hard 404 into a soft 200, defeating every error path. |
| **Recommended fix** | Restore `/basis/`, `/textures/manifest.json`, `/models/award.glb`; make the server return real `404`s so failures are loud. |
| **Regression risk** | Low for the assets; the 404 change is covered in **H4**. |
| **Note** | The award fallback is *graceful* (no crash) — which is exactly why it will go unnoticed. |

### H4 — Soft-404 on every unknown route

| Field | Detail |
|---|---|
| **Severity** | HIGH (correctness / SEO / masks H3 and C2) |
| **Status** | **CONFIRMED** |
| **Description** | The fallback in `server.js` serves `site_build/index.html` with **HTTP 200** for anything unmatched, regardless of the requested file type. |
| **Reproduction** | `curl` any of: `/nonexistent-page`, `/projects/dothings/`, `/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/api/subscribe`, `/textures/manifest.json`, `/models/award.glb`. |
| **Affected components** | `server.js` fallback branch |
| **Relevant code** | `else { filePath = path.join(PUBLIC_DIR, 'index.html'); }` |
| **Measurement** | All listed paths → `200`, `Content-Type: text/html`, 38,690 B. Only `/projects/` correctly returns `404 text/plain`. |
| **Expected** | `404` + a real error document; correct MIME types for `.txt`/`.xml`/`.json`. |
| **Observed** | Homepage HTML with 200 for everything. |
| **Root cause** | Unconditional SPA fallback with no extension awareness and no 404 document. |
| **Recommended fix** | Only apply the SPA fallback to extensionless routes that should be app routes; return a real `404.html` otherwise. |
| **Regression risk** | Low–medium — must keep deep links working for the 11 real routes. |
| **Consequences** | Search engines index duplicate homepage content under infinite URLs; `robots.txt`/`sitemap.xml` return HTML; asset failures become invisible (H3); the newsletter failure is masked (C2). |

---

## 4. Findings — MEDIUM

### M1 — No `prefers-reduced-motion` support anywhere

| Field | Detail |
|---|---|
| **Severity** | MEDIUM (accessibility) |
| **Status** | **CONFIRMED** — 0 occurrences in CSS and JS |
| **Description** | A site that is 100% motion and WebGL offers no reduced-motion path. |
| **Reproduction** | Enable "reduce motion" in OS/browser settings; observe identical animation behaviour. |
| **Affected components** | Global |
| **Relevant code** | — (absence) |
| **Measurement** | `prefers-reduced-motion`: 0 in `site_build/index.html`, 0 in `DZyj3ghP.js` |
| **Expected** | Reduced/removed transitions and no continuous ambient motion. |
| **Observed** | No branch exists. |
| **Root cause** | Never implemented. |
| **Recommended fix** | Gate ambient loops and transitions on `matchMedia('(prefers-reduced-motion: reduce)')`. |
| **Regression risk** | Low. |

### M2 — Pinch-zoom and text resizing are globally disabled

| Field | Detail |
|---|---|
| **Severity** | MEDIUM (accessibility, mobile) |
| **Status** | **CONFIRMED** |
| **Description** | `touch-action: none` on `body, html` blocks pinch-zoom; `-webkit-text-size-adjust: none` blocks mobile text resizing. |
| **Reproduction** | On a touch device, attempt pinch-zoom or browser text-size increase. |
| **Affected components** | Global CSS |
| **Relevant code** | `body,html{…touch-action:none…}` and `-webkit-text-size-adjust:none` |
| **Measurement** | 1 occurrence each |
| **Expected** | Zoom/resize permitted (WCAG 1.4.4). |
| **Observed** | Blocked. |
| **Root cause** | Deliberate choice to keep the WebGL canvas gesture-exclusive. |
| **Recommended fix** | Scope `touch-action: none` to the canvas element only, not `body,html`; drop the text-size-adjust override. |
| **Regression risk** | Medium — must verify drag/scroll gestures still work on the canvas. |

### M3 — Full-DOM `querySelectorAll` every 60 frames

| Field | Detail |
|---|---|
| **Severity** | MEDIUM (performance) |
| **Status** | **CONFIRMED** (code) / **LIKELY** (impact) |
| **Description** | A cursor-ball collision system re-scans the entire document for `[data-gl-shield]` every `IB = 60` frames (~1×/sec at 60 fps). |
| **Reproduction** | Profile with the cursor visible; look for periodic `querySelectorAll` entries. |
| **Affected components** | `jB` cursor-ball shield scan |
| **Relevant code** | `--this.ballScan<=0 && (this.ballScan=IB, this.ballShield=[...document.querySelectorAll("[data-gl-shield]")])` |
| **Measurement** | Interval constant `IB = 60`. Cost is DOM-size-dependent; **not quantified** (no browser). |
| **Expected** | Incremental registry (MutationObserver) rather than periodic full scans. |
| **Observed** | Periodic full-document scan. |
| **Root cause** | Polling instead of observation. |
| **Recommended fix** | Maintain the shield list from the existing `MutationObserver`, or rescan only on route change. |
| **Regression risk** | Low. |

### M4 — Per-frame uniform hashing to decide whether to render

| Field | Detail |
|---|---|
| **Severity** | MEDIUM (performance) |
| **Status** | **CONFIRMED** (code) / **LIKELY** (cost) |
| **Description** | The idle system computes a digest over camera quaternion, geometry ids/position versions, and **every material uniform** on **every frame** to decide whether a redraw is needed. Correct, but it is O(uniforms) work per frame even when idle. |
| **Reproduction** | Profile idle state; inspect `digest`/`fold`/`value` self-time. |
| **Affected components** | `FU` (idle controller) — `should()`, `digest()`, `fold()`, `value()` |
| **Relevant code** | `should(e){ … const s=this.digest(); return s===this.hash ? (this.skipped++,!1) : this.take(s) }` |
| **Measurement** | Runs unconditionally each tick. Cost **not quantified** (no browser). |
| **Expected** | Cheap dirty-flags set by the systems that actually mutate state. |
| **Observed** | Full uniform-space hashing per frame. |
| **Root cause** | Pull-based change detection. |
| **Recommended fix** | Set an explicit dirty flag from GSAP `onUpdate` / pointer / resize handlers instead of hashing. |
| **Regression risk** | Medium — must not miss legitimate changes, or frames freeze. |

### M5 — Up to 15 `<video>` elements created and never released

| Field | Detail |
|---|---|
| **Severity** | MEDIUM (resource) |
| **Status** | **CONFIRMED** (code) |
| **Description** | Each unique video URL creates a `<video>` element + texture + `requestVideoFrameCallback` loop, stored in `this.videos` forever. Playback *is* gated (alpha > 0.02 and white < 0.98), but elements and decoded frames persist. |
| **Reproduction** | Visit all 8 project pages; then `document.querySelectorAll('video').length`. |
| **Affected components** | `jB.video()`, `applyVideo()`, `playVideo()` |
| **Relevant code** | `video(e){ … i.muted=!0,i.loop=!0,i.playsInline=!0,i.crossOrigin="anonymous" … this.videos.set(e,t) … }` |
| **Measurement** | 15 unique video streams across the 8 featured projects (from payload). |
| **Expected** | Videos disposed when their project is left. |
| **Observed** | Retained for app lifetime. |
| **Root cause** | See **H2**. |
| **Recommended fix** | Pause + `src=""` + `load()` + delete from Map on route leave. |
| **Regression risk** | Medium — must keep the hero video alive across transitions. |

### M6 — No WebGL-unavailable fallback

| Field | Detail |
|---|---|
| **Severity** | MEDIUM (resilience) |
| **Status** | **CONFIRMED** (absence) |
| **Description** | No `<noscript>` content and no canvas-less fallback. All visible typography is drawn by WebGL; DOM text is transparent (`-webkit-text-fill-color: transparent`) and `pointer-events-none`. |
| **Reproduction** | Disable WebGL / JS and load `/`. |
| **Affected components** | Global |
| **Relevant code** | `<noscript` count = 0; `[-webkit-text-fill-color:transparent]` on all `data-gl="text"` spans |
| **Measurement** | 0 `<noscript>` elements; all body text mirrored into transparent spans |
| **Expected** | Readable text-only fallback. |
| **Observed** | Inert black page. |
| **Root cause** | Canvas-first architecture with no progressive-enhancement layer. |
| **Recommended fix** | Add a `<noscript>` block and a WebGL-capability check that reveals the DOM text layer. |
| **Regression risk** | Low. |

### M7 — 100% of imagery and video is remote, with zero local fallback

| Field | Detail |
|---|---|
| **Severity** | MEDIUM (resilience) |
| **Status** | **CONFIRMED** |
| **Description** | Every image and video comes from `datocms-assets.com` / `image.mux.com` / `stream.mux.com`. Only the font is local. |
| **Reproduction** | Block those hosts (as this sandbox does) and load `/`. |
| **Affected components** | All media |
| **Relevant code** | 92 unique media URLs across 3 hosts |
| **Measurement** | 78 DatoCMS entries, 51 Mux image, 51 Mux stream; local media files: 0 |
| **Expected** | At least poster/fallback images bundled locally. |
| **Observed** | Text on black background; no error placeholders. |
| **Root cause** | CDN-only media strategy. |
| **Recommended fix** | Bundle low-res posters or an SVG placeholder per project. |
| **Regression risk** | Low. |

### M8 — No HTTP compression or cache headers

| Field | Detail |
|---|---|
| **Severity** | MEDIUM (performance) |
| **Status** | **CONFIRMED** |
| **Description** | `server.js` serves a 1.09 MB JS chunk and 515 KB WASM uncompressed with no `Cache-Control`/`ETag`. |
| **Reproduction** | `curl -sD - -o /dev/null http://host:3000/_nuxt/DZyj3ghP.js` |
| **Affected components** | `server.js` |
| **Relevant code** | `res.writeHead(200, { 'Content-Type': contentType })` |
| **Measurement** | No `Content-Encoding`, no `Cache-Control`, no `ETag` on any response. |
| **Expected** | gzip/brotli + immutable caching for hashed assets. |
| **Observed** | Identity encoding, no caching. |
| **Root cause** | Minimal static server. |
| **Recommended fix** | Serve from a CDN or any static host that compresses and sets immutable cache headers on `/_nuxt/*`. |
| **Regression risk** | None (deployment-level). |

### M9 — MSAA antialiasing enabled unconditionally

| Field | Detail |
|---|---|
| **Severity** | MEDIUM (mobile GPU cost) |
| **Status** | **CONFIRMED** (code) / **LIKELY** (impact) |
| **Description** | The renderer is created with `antialias: true` regardless of device or DPR. At DPR 2 the MSAA cost is substantial on mobile GPUs. |
| **Reproduction** | Compare GPU frame time on a mobile device with antialias forced off. |
| **Affected components** | `BU.mount()` renderer creation |
| **Relevant code** | `antialias:!0` |
| **Measurement** | Not quantified (no browser/GPU). |
| **Expected** | Disable MSAA when DPR ≥ 2 (DPR already provides supersampling). |
| **Observed** | Always on. |
| **Root cause** | Static renderer config. |
| **Recommended fix** | `antialias: window.devicePixelRatio < 2`. |
| **Regression risk** | Low–medium — visual edge quality on low-DPI displays. |

---

## 5. Findings — LOW

| ID | Title | Status | Evidence | Fix |
|---|---|---|---|---|
| **L1** | `favicon.ico` is an HTML document | CONFIRMED | 17,656 B starting `<!DOCTYPE html>`, served as `image/x-icon` | Replace with a real icon |
| **L2** | `/llms.txt` dead link on all 11 pages | CONFIRMED | Linked in every footer; absent on disk; soft-404s | Ship the file (exists on the live site) |
| **L3** | No `robots.txt` / `sitemap.xml` | CONFIRMED | Both exist in production, absent here | Generate both |
| **L4** | No security headers | CONFIRMED | CSP, `X-Content-Type-Options`, `X-Frame-Options`, HSTS, `Referrer-Policy` all absent | Set at the host/CDN |
| **L5** | Newsletter email input has no visible focus ring | CONFIRMED | Input carries `outline-none` with no replacement indicator | Add `:focus-visible` styling |
| **L6** | `canonical` and `og:url` are relative | CONFIRMED | e.g. `og:url = /projects/griflan` | Emit absolute URLs |
| **L7** | No skip-to-content link | CONFIRMED | Absent | Add one |
| **L8** | All 129 images have empty `alt` | CONFIRMED | `alt:""` on every entry | Describe meaningful imagery |
| **L9** | Server accepts PUT/DELETE/PATCH | CONFIRMED | All return `200` | Restrict to GET/HEAD/OPTIONS |
| **L10** | ~20 unreferenced duplicate files at repo root | CONFIRMED | `body.html`, `full_page.html`, `original_page.html`, `project_page.html`, `payload.json`, `projects_parsed.json`, `style_*.css`, `nuxt_*.js`×7, `assets_site/`; byte-identical to `site_build/` copies; referenced by nothing | Delete or move out of the repo |
| **L11** | Two orphan chunks | CONFIRMED | `C4m1BJfK.js`, `basis_transcoder.VXdx5NbI.wasm` not referenced by any HTML | Verify they are dynamic-import targets (the WASM is) and keep; otherwise prune |
| **L12** | No `<header>`/`<footer>` landmarks | CONFIRMED | Divs used instead | Use semantic elements |
| **L13** | Leftover scaffolding comments in `server.js` | CONFIRMED | `// If requesting /_payload.json` above unrelated code | Clean up |
| **L14** | Trail decay uses unbounded accumulation guard | INFO/LOW | Shader clamps height field to `min(h, 1.5)` — correctly bounded | None needed |

---

## 6. Findings — INFO (not defects, but you should know)

| ID | Observation | Why it matters to you |
|---|---|---|
| **I1** | Idle renderer skips unchanged frames, with a 250 ms forced-redraw floor | Battery-friendly; do not "fix" by forcing 60 fps |
| **I2** | Frame delta clamped to `1/20` (50 ms) | Prevents animation explosions after tab-switch; keep this when you refactor |
| **I3** | Shaders pre-compiled at mount inside `try{}` | Reduces first-frame stall; preserve |
| **I4** | Reflection is a shader floor plane + 10%-scale RT, not a second scene pass | Cheap; do not replace with `Reflector` |
| **I5** | Trail is 2 × 256² ping-pong | Deliberately cheap; do not raise resolution |
| **I6** | DPR capped at 2, `powerPreference: "high-performance"` | Correct; keep the cap |
| **I7** | Context-loss handlers present | Good resilience baseline |
| **I8** | Plane disposal does free material + texture | The leak in **H2** is in the JS-side Maps, not in plane disposal |
| **I9** | Non-featured projects intentionally have no case-study page | Not a bug — 15 of 23 are name-only by design; all link out correctly |
| **I10** | `.graphql` strings are DatoCMS error messages | Not broken imports — verified false positive |
| **I11** | Prev/next links carry `aria-label="Previous project: …"` | Accessible; do not "fix" the empty text nodes |

---

## 7. Phase 3 — Interaction Stress-Test Matrix (NOT EXECUTED)

Every sequence below requires a browser. They are listed so you can run them; **none were executed and none are reported as passing or failing.**

| # | Sequence | What to watch | Status |
|---|---|---|---|
| 1 | Open project, close immediately | Orphaned plane, stuck wipe, frozen `hole` | **NOT EXECUTED** |
| 2 | Rapid switching between projects | Tween pile-up, `flights` array growth | **NOT EXECUTED** |
| 3 | Drag during animation | Momentum + drag conflict | **NOT EXECUTED** |
| 4 | Scroll while moving pointer | Shield list staleness (M3) | **NOT EXECUTED** |
| 5 | Release drag outside gallery | Stuck `grabbing` class | **NOT EXECUTED** |
| 6 | Pointer leaves viewport and returns | `ball.seen` reset logic | **NOT EXECUTED** |
| 7 | Repeated clicks on controls | Double-triggered navigation | **NOT EXECUTED** |
| 8 | Rapid scroll to sheet top/bottom | Clip-path tearing | **NOT EXECUTED** |
| 9 | Resize during animation | RT realloc + `reflectTarget` dispose/recreate | **NOT EXECUTED** |
| 10 | Reload in various states | Hydration mismatch | **NOT EXECUTED** |
| 11 | Toggle Featured ↔ Full repeatedly | Card pool churn (H2) | **NOT EXECUTED** |
| 12 | Open/close multiple projects consecutively | Texture/video accumulation (H2, M5) | **NOT EXECUTED** |
| 13 | Browser back / forward | Router vs WebGL state desync | **NOT EXECUTED** |
| 14 | Interrupt animations with input | `wipe.abort()` path | **NOT EXECUTED** |
| 15 | Rapid touch gestures | `touch-action:none` conflicts (M2) | **NOT EXECUTED** |

**Code-level observations relevant to these tests** (CONFIRMED, static):

- `depart()` iterates `this.leaving`, marks entries `stale`, and relies on `fadeOut`/`syncLeaving` to filter — the array *is* cleaned up (`this.leaving = this.leaving.filter(i => i !== e)`). **Not a leak.**
- `this.flights` *is* cleared after `fe.killTweensOf(e)`. **Not a leak.**
- `fadeOut` guards re-entry with `if (e.fading) return`. **Good.**
- `this.blastHeld` forces `this.rail.bind(null)` on depart. **Good.**
- `destroy()` on the core disposes `reflectTarget`, `post`, `wipe`, `renderer`, and removes the canvas — but **is never called by the app** (only one `.destroy()` call site exists in the whole bundle, inside three.js's program cache). Relies on page unload for GPU cleanup.
- `watchBall()` and `watchTab()` add 3 window/document listeners with **no removal** — safe only because the stage is a Nuxt plugin **singleton** created once per app lifetime (`new jB(n)` inside `Pn(...)`), and `mount()` is called once. Do not convert the stage to a per-route component without adding cleanup.

---

## 8. Phase 7 — Responsive Audit

### 8.1 Computed scale curve (CONFIRMED — arithmetic)

```
html { font-size: clamp(5px, 20px, 10 * 100vw / var(--size)) }
:root { --size: 390 }   @media (min-width: 650px) { :root { --size: 1500 } }
body { font-size: 1.4rem }
```

| Viewport | `--size` | Root px | Body px | Note |
|---|---|---|---|---|
| 320 | 390 | 8.21 | 11.49 | |
| 360 | 390 | 9.23 | 12.92 | |
| 390 | 390 | 10.00 | 14.00 | design reference |
| 430 | 390 | 11.03 | 15.44 | |
| **649** | 390 | **16.64** | **23.30** | |
| **650** | 1500 | **5.00** | **7.00** | **70% collapse (H1)** |
| 768 | 1500 | 5.12 | 7.17 | iPad portrait |
| 1024 | 1500 | 6.83 | 9.56 | |
| 1280 | 1500 | 8.53 | 11.95 | |
| 1440 | 1500 | 9.60 | 13.44 | |
| 1920 | 1500 | 12.80 | 17.92 | |
| 2560 | 1500 | 17.07 | 23.89 | |

### 8.2 Breakpoint inventory (CONFIRMED)

| Breakpoint | Source | Consistent? |
|---|---|---|
| 650 px | CSS `min-width:650px` (multiple rules) | ✅ |
| 649 px | JS `small: clientWidth <= 649` | ✅ matches CSS |
| 1100 / 1300 / 1400 px | CSS only | ⚠️ no JS counterpart |
| `hover:hover` / `pointer:fine` | CSS + JS `matchMedia` | ✅ |
| `hover:none` / `pointer:coarse` | CSS | ✅ |

### 8.3 Rendered layout, overflow, clipping, DPR scaling at each width

**NOT TESTED — no browser.** No screenshot, computed-style, or overflow measurement exists for any of the 12 requested widths. Only the arithmetic above is available.

### 8.4 GPU workload by viewport (CONFIRMED — computed, §1.2)

Mobile 390×844 → 5.6 MB RT budget (DPR capped 3→2). Desktop 1920×1080 @DPR2 → 32.5 MB. Large screens do **not** create excessive render targets; the DPR cap is doing the heavy lifting. Mobile is not disproportionately expensive on render targets — but MSAA (M9) and texture memory (H2) hit it hardest.

---

## 9. Phase 5 — Media & Asset Reliability

| Check | Result |
|---|---|
| Broken image URLs | **NOT TESTED** — CDN egress blocked. 70 unique URLs enumerated and structurally valid (DatoCMS/Mux with `w`/`h`/`fit` params). |
| Video streams present | 22 unique stream URLs; **NOT TESTED** for availability. |
| Poster fallback | Present in data (`src` = Mux `thumbnail.jpg` alongside `video`) ✅ structurally sound |
| Inconsistent dimensions | Declared intrinsic sizes vary widely (up to 3420×2201); CDN caps delivery at `w=1200`/`600` or crop `1200×630` ✅ consistent delivery |
| Delayed decode | Uses `ImageBitmapLoader`/`createImageBitmap` ✅ off-main-thread decode |
| Layout shift during load | **LIKELY** — images have no `width`/`height` attributes in HTML (no `<img>` tags exist; all canvas), so CLS is driven by texture arrival. **NOT TESTED.** |
| Font loading | ✅ Local, `font-display: swap`, valid woff2, 115 KB |
| External outage behaviour | **CONFIRMED by construction**: all imagery/video gone, text remains. No error placeholders. |
| Offline behaviour | **CONFIRMED by construction**: black page with text; JS/WASM/font still load locally |
| Slow-connection stutter | **LIKELY** — 28 textures up to 9 MB each arriving mid-animation; no preloading strategy visible for project media. **NOT TESTED.** |

---

## 10. Phase 9 — Production Build & Deployment Check

| Check | Result |
|---|---|
| Build output complete | ✅ 11 pages, 12 chunks, WASM, font, payload |
| JS chunk loading | ✅ all local specifiers resolve; no broken imports |
| WASM loading | ✅ served `application/wasm`, 527,333 B, valid magic |
| Font loading | ✅ `font/woff2`, valid |
| Static asset paths | ✅ all `/_nuxt/...` root-relative |
| Direct URL access | ✅ all 11 routes return their own document |
| Production runtime errors | **NOT TESTED** — no browser |
| External media requests | **NOT TESTED** — CDN blocked |
| HTTP compression | ❌ none (M8) |
| Cache headers | ❌ none (M8) |
| 404 handling | ❌ soft-404 (H4) |
| Security headers | ❌ none (L4) |
| Path traversal | ❌ **CRITICAL, unfixed** (C1) |
| `/api/subscribe` | ❌ missing (C2) |
| `/basis/`, `/textures/manifest.json`, `/models/award.glb` | ❌ missing (H3) |

**This is a production *build*, not a production *deployment*.** The static artifacts are complete and internally consistent; the server layer and hosting configuration are absent. A successful preview here means only that files serve — it says nothing about whether the newsletter works, whether awards render correctly, or whether unknown URLs behave.

---

## 11. Recommended Re-Test Protocol (run in a real browser)

To convert the LIKELY/UNVERIFIED items into measurements:

```js
// 1. FPS / frame-time distribution (rAF-based, no dependencies)
const times = [];
let last = performance.now();
(function loop(t){ times.push(t - last); last = t; requestAnimationFrame(loop); })(last);
// after 10s of interaction:
const sorted = times.slice().sort((a,b)=>a-b);
const pct = p => sorted[Math.floor(sorted.length*p)];
console.table({
  frames: times.length,
  avgFPS: 1000/(times.reduce((a,b)=>a+b,0)/times.length),
  p50: pct(.5), p95: pct(.95), p99: pct(.99),
  over16ms: times.filter(t=>t>16.7).length,
  over50ms: times.filter(t=>t>50).length,
  worst: Math.max(...times)
});
```

```js
// 2. Resource growth (run after every project open/close cycle)
const gl = document.querySelector('canvas').getContext('webgl2');
const dbg = gl.getExtension('WEBGL_debug_renderer_info');
console.log(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'renderer hidden');
console.log({
  heap: performance.memory?.usedJSHeapSize,
  videos: document.querySelectorAll('video').length,
  domNodes: document.getElementsByTagName('*').length,
  textures: performance.getEntriesByType('resource').filter(r=>/\.(jpg|webp|png)/.test(r.name)).length
});
```

**Critical:** if `UNMASKED_RENDERER_WEBGL` reports `SwiftShader`, `llvmpipe`, or `Google SwiftShader`, you are on a **software rasteriser** — its FPS must **not** be reported as hardware GPU performance.

**Suggested sequence:** warm-up 5 s → homepage idle 10 s → hover each card → open/close all 8 projects twice → toggle Featured/Full 10× → resize across 320/650/768/1440 → rapid back/forward 20× → capture §11.1 and §11.2 after each phase.

---

## 12. Prioritised Fix List

| Priority | ID | Action | Effort |
|---|---|---|---|
| **P0** | C1 | Fix path traversal in `server.js` (or replace with a real static host) | Trivial |
| **P0** | C2 | Restore `/api/subscribe`; fail loudly on non-JSON responses | Small |
| **P0** | H3 | Restore `/basis/`, `/textures/manifest.json`, `/models/award.glb` | Small |
| **P1** | H4 | Real 404s instead of homepage fallback | Small |
| **P1** | H1 | Fix the 650 px `--size` discontinuity | Medium |
| **P1** | H2 | Add reference-counted texture/video eviction | Medium |
| **P2** | M1 | `prefers-reduced-motion` support | Medium |
| **P2** | M2 | Scope `touch-action:none` to canvas; restore text resize | Small |
| **P2** | M5 | Release video elements on route leave | Small |
| **P2** | M8 | Enable compression + immutable caching at the host | Trivial |
| **P3** | M3, M4 | Replace polling/hashing with explicit dirty flags | Medium |
| **P3** | M6, M7 | `<noscript>` + local poster fallbacks | Small |
| **P3** | M9 | Disable MSAA when DPR ≥ 2 | Trivial |
| **P4** | L1–L13 | Icon, robots/sitemap, security headers, a11y polish, repo cleanup | Small |

---

## 13. Bottom Line

**Is this site hiding bugs? Yes — but not where you'd expect.**

The render loop is the *best-built part of this codebase*. Delta clamping, digest-based idle skipping, shader pre-compilation, a 2× DPR cap, throttled resize, cheap 256² trail targets, and a 10%-scale reflection target are all deliberate, competent engineering. I found **no structural reason to expect frame-pacing stutter** from the loop itself.

The real problems are at the **seams between the build and the server**:

1. **Three hardcoded asset paths don't exist** and are silently swallowed — so award medals render as generic primitives and KTX2 is permanently off (H3).
2. **The newsletter lies about success** (C2).
3. **Nothing is ever evicted** — textures and videos accumulate for the app's lifetime (H2). Harmless at 8 projects; a real leak once you add your own.
4. **Every unknown URL returns the homepage with 200**, which is precisely why (1) and (2) are invisible (H4).

And one pure-CSS defect that will bite immediately: **crossing 650 px shrinks the entire interface by 70%** (H1) — body text lands at ~7 px on tablets.

**What I could not do:** measure a single frame. No browser, no GPU, and every browser CDN blocked. Every FPS, frame-time, latency, and heap figure in this document is marked NOT MEASURED rather than estimated — because a fabricated number would be worse than no number when you're deciding what to fix.

**Fix C1, C2, H3, H4 before you touch a single line of content.** They are cheap, they are the reason the site's failures are invisible, and H2/H1 become architectural once you start swapping in your own projects.

---

## Appendix — Evidence Index

| Claim | Method |
|---|---|
| No browser / no GPU | Filesystem search for `chrome`/`chromium`/`firefox`/`headless_shell`; `/dev/dri` absent; CDN egress probes returned `000` |
| Path traversal (C1) | 4 payloads via `curl --path-as-is`; all `200` + 2,351 B source |
| Newsletter (C2) | `POST /api/subscribe` → `200 text/html` 38,690 B; success branch read from bundle |
| 650 px collapse (H1) | Arithmetic on `clamp(5px,20px,10*100vw/var(--size))`; verified only two `--size` definitions exist |
| No eviction (H2) | `grep` counts: `this.cache.delete`=0, `this.resolved.delete`=0, `this.videos.delete`=0, `this.items.delete`=0, `.clear()`=0 |
| Missing paths (H3) | Disk check + `curl` → all `200 text/html`; fallback code read from bundle |
| Soft-404 (H4) | 8 unknown paths probed → `200 text/html` |
| `prefers-reduced-motion` absent (M1) | 0 occurrences in CSS and JS |
| `touch-action:none` (M2) | 1 occurrence, global `body,html` |
| 60-frame DOM scan (M3) | `IB=60` constant + `querySelectorAll("[data-gl-shield]")` |
| Per-frame hashing (M4) | `FU.should()` → `digest()` over camera/geometry/all uniforms |
| Video retention (M5) | `this.videos.set()` with no delete; 15 streams in payload |
| No compression (M8) | Response headers: no `Content-Encoding`, no `Cache-Control`, no `ETag` |
| Texture memory (§1.3) | Computed from 70 payload URLs + DatoCMS `w`/`h` caps |
| Render-target memory (§1.2) | Computed from `setPixelRatio(min(2,dpr))`, `ts=256`, `N0=.1` |
| Renderer settings | Extracted from bundle: `antialias:!0`, `powerPreference:"high-performance"`, `alpha:!0` |
| Idle system | `OU=.25`, `digest()`/`fold()`/`value()`, `skipped`/`drawn` counters |
| Cleanup correctness | `destroy()`, `drop()`, `syncLeaving()`, `fadeOut()` inspected; `leaving` and `flights` confirmed cleaned |
| Live-site comparison | Fetched live `/llms.txt`, `/robots.txt`, `/sitemap.xml`, `/index.md`, `/newsletter.md` — all present in production, absent here |
