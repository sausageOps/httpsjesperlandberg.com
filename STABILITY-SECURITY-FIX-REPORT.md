# Stability, Security & Resource-Management Fix Report

**Repository:** `sausageOps/httpsjesperlandberg.com`
**Branch:** `arena/a8cee66f-httpsjesperlandberg-com` (base `e27248e`)
**Date:** 2026-11-24
**Scope:** Targeted correction of the confirmed defects in `BUG-PERFORMANCE-STABILITY-AUDIT.md`, ahead of content replacement.
**Constraint honoured:** no redesign, no animation constants changed, no shaders touched, no new dependencies.

---

## 0. Verification Environment — Read This First

| Property | Value |
|---|---|
| Browser available | **NONE** (no Chrome/Chromium/Firefox/WebKit on the system) |
| GPU | **NONE** (`/dev/dri` absent) |
| Browser CDNs | **BLOCKED** — no browser binary could be obtained |
| Node | v22.22.3 |

**Consequence:** every fix was verified by **HTTP probing of the running server**, **byte-level inspection**, **syntax validation**, **arithmetic derivation**, and **unit-testing the real shipped eviction code in Node**. Nothing was verified by rendering.

No FPS figure is reported anywhere in this document, because no rendering environment exists. Rendered-layout confirmation for Phase 2 is the one item that genuinely required a browser and could not be done.

---

## 1. Path Traversal Correction — **VERIFIED**

### The defect
`path.join(PUBLIC_DIR, pathname)` was applied to a `decodeURIComponent`'d URL path with no containment check.

### The fix (`server.js`, fully rewritten)
A single canonical public root is the only readable location, enforced at three independent layers:

1. **Lexical containment** — `path.resolve(PUBLIC_ROOT, '.' + pathname)` then `isInside()` using a `path.relative()` **path-boundary** check (so `/site_build_evil` does not match `/site_build`).
2. **Realpath containment** — after `fs.statSync`, `fs.realpathSync()` resolves symlinks and the prefix check runs **again on the real path**. A symlink inside the public root pointing outside is rejected.
3. **Explicit denylist** — any path segment starting with `.` (hidden files/dirs) or matching `server.js`, `package.json`, `.env`, `.git`, lockfiles, etc. → `403`.

Additional hardening:
- Backslashes normalised to `/` before resolution (Windows-style traversal).
- Duplicate slashes collapsed.
- NUL bytes and control characters rejected → `400`.
- Malformed percent-encoding caught → `400`.
- Directories serve `index.html` only; **directory listing is impossible** (no index → `404`).
- Non-regular files (sockets, FIFOs) → `404`.
- Methods restricted to `GET`/`HEAD`; everything else → `405` with `Allow`.
- `X-Content-Type-Options: nosniff` and `Referrer-Policy` added. **`X-Frame-Options` deliberately NOT set** so the site remains embeddable in the Arena preview iframe.

### Test results — 21 payloads, **0 leaks**

| Payload | Result |
|---|---|
| `/../server.js` | 403 |
| `/..%2fserver.js` | 403 |
| `/%2e%2e/server.js` | 403 |
| `/_nuxt/../../server.js` | 403 |
| `/./../server.js` | 403 |
| `/%2e%2e%2fserver.js` | 403 |
| `/..\server.js` (literal backslash) | 403 |
| `/%5c..%5cserver.js` (encoded backslash) | 403 |
| `/....//server.js` | 403 |
| `/../../etc/passwd` | 403 |
| `/../../../etc/passwd` | 403 |
| `/%2e%2e/%2e%2e/etc/passwd` | 403 |
| `/..;/server.js` | 403 |
| `/%00../server.js` (NUL) | 400 |
| `/.git/config` | 403 |
| `/.env` | 403 |
| `/package.json` | 403 |
| `/_nuxt/..%2f..%2fserver.js` | 403 |
| `/projects/../../../server.js` | 403 |
| `/face.png/../../server.js` | 403 |
| `/%252e%252e/server.js` (double-encoded) | 403 |

**Source-code leaks detected: 0.** Every response was checked for `require('http')` — none matched.

**Legitimate delivery preserved:** all 10 routes `200`; JS `200 application/javascript`; WASM `200 application/wasm`; font `200 font/woff2`; PNG `200 image/png`; all `_payload.json` `200 application/json`.

---

## 2. 650 px Responsive Breakpoint — **PARTIALLY VERIFIED** (arithmetic verified, rendering not)

### Root cause
`html{font-size:clamp(5px,20px,10 * 100vw/var(--size))}` with `--size` stepping **390 → 1500** at 650 px. The two design scales never meet, so crossing the breakpoint shrank every `rem` dimension by ~70%.

### The fix (single fluid rule, no media-query overrides)
`--size` removed entirely (it was used in exactly one place). Replaced with a continuous three-segment model expressed as nested `max()`/`min()`:

```css
html{font-size:clamp(5px,20px,max(0.66667vw,min(2.5641vw,33.7683px - 2.63102vw)));}
```

- **≤ 650 px** → `2.5641vw` = `10*100vw/390` — the original mobile curve, **unchanged**
- **650–1024 px** → linear bridge from 16.667 px down to 6.827 px
- **≥ 1024 px** → `0.66667vw` = `10*100vw/1500` — the original desktop curve, **unchanged**
- Outer `clamp(5px,20px,…)` preserves the original 5 px floor and 20 px cap

### Measured result

| Width | Old root | New root | Old body | New body | Delta |
|---|---|---|---|---|---|
| 320 | 8.205 | 8.205 | 11.487 | 11.487 | **0.000** |
| 360 | 9.231 | 9.231 | 12.923 | 12.923 | **0.000** |
| 390 | 10.000 | 10.000 | 14.000 | 14.000 | **0.000** |
| 430 | 11.026 | 11.026 | 15.436 | 15.436 | **0.000** |
| 640 | 16.410 | 16.410 | 22.974 | 22.974 | **0.000** |
| 649 | 16.641 | 16.641 | 23.297 | 23.297 | **0.000** |
| **650** | **5.000** | **16.667** | **7.000** | **23.333** | +11.667 |
| 651 | 5.000 | 16.640 | 7.000 | 23.296 | +11.640 |
| 680 | 5.000 | 15.877 | 7.000 | 22.228 | +10.877 |
| 768 | 5.120 | 13.562 | 7.168 | 18.987 | +8.442 |
| 1024 | 6.827 | 6.827 | 9.557 | 9.557 | **0.000** |
| 1440 | 9.600 | 9.600 | 13.440 | 13.440 | **0.000** |
| 1920 | 12.800 | 12.800 | 17.920 | 17.920 | **0.000** |
| 2560 | 17.067 | 17.067 | 23.893 | 23.893 | **0.000** |

**Cliff eliminated:** the largest per-pixel step anywhere in 300–1600 px is now **0.0263 px** (at 665 px). It was **11.641 px** at 649→650.

Smoothness at the breakpoint:
```
648px -> 16.6154px   (step +0.0256)
649px -> 16.6410px   (step +0.0256)
650px -> 16.6667px   (step +0.0256)
651px -> 16.6404px   (step -0.0263)
652px -> 16.6140px   (step -0.0263)
```

### Status caveat
The **arithmetic is verified** and the shipped CSS is confirmed present in all 10 pages (`--size` references: 0). But **actual rendered layout, text wrapping, card proportions and sheet geometry at each width could not be inspected** — no browser. Treat the numbers as exact and the visual result as needing one screenshot pass at 649/650/651 px.

---

## 3. Resource Eviction — **PARTIALLY VERIFIED** (logic unit-tested, runtime not)

### Investigation of ownership (as instructed — nothing blindly cleared)

| Collection | Purpose | Decision |
|---|---|---|
| `this.items` | **Project catalogue records**, keyed by slug (`items.set(a.slug, a)`) | **NEVER evicted** — explicitly protected |
| `this.cache` | URL → in-flight load promise (dedupe) | Evicted with its texture |
| `this.resolved` | URL → loaded `THREE.Texture` | Evicted when unreferenced + stale |
| `this.videos` | URL → `{el, texture, playing, blind}` | Evicted when idle + unreferenced + stale |

### Implementation
- Added `this.texStamp` (URL → last-request time).
- `texture(e)` and `video(e)` stamp on **every** call, so recency tracks real usage.
- Added four methods to the GL stage:
  - `liveTextures()` — collects every texture still bound to a live plane by scanning `content`, `page`, `overlay`, `texts`, `hud`, `pills`, `rings`, `awards`, `leaving`, `cards`, `rail.items`, `reg.planes`, `hero`, `titleHero`.
  - `releaseTexture(url, tex, closeBitmap)` — disposes the GPU texture, optionally closes the `ImageBitmap`, deletes from `resolved`, `cache`, `texStamp`.
  - `releaseVideo(url, v)` — pauses, removes `src`, calls `load()` to release the decoder, disposes the texture, removes the element, deletes from the map.
  - `evictStale()` — sweeps both maps.
- Wired via `setInterval(..., 15 s)` in the singleton `mount()`.

### Safety rules
| Rule | Value | Why |
|---|---|---|
| Staleness floor | 8 000 ms | in-flight loads are never evicted |
| `ImageBitmap` close threshold | 60 000 ms | only long-dead resources lose their decoded pixels |
| Shared textures | protected by **object identity** | a texture held by 2 planes survives until both go |
| Playing videos | never evicted | no mid-playback teardown |
| Catalogue | never touched | `this.items` is data, not media |

`createObjectURL` is **never used** in this bundle (0 occurrences), so there is nothing to revoke.

### Unit test results — 22/22 passed against the **real shipped code**
The methods were extracted from the bundle and executed in Node:

```
[1] orphan texture evicted, live survives          PASS (6 assertions)
[2] shared texture referenced by several planes    PASS (survives)
[3] recently-requested resource never evicted      PASS (in-flight protection)
[4] video lifecycle                                 PASS (paused, src released, element removed, map cleared)
[5] actively-playing video never evicted           PASS
[6] eviction permits reload                         PASS (cache cleared -> refetch)
[7] project catalogue (this.items) never touched    PASS
[8] 50 open/close cycles                            PASS (50 reclaimed, resident stabilises at 0)
=== 22 passed, 0 failed ===
```

### Resource measurements, before vs after

| Metric | Before | After |
|---|---|---|
| `.delete()` / `.clear()` calls on the four maps | **0** | present, guarded |
| Eviction mechanism | none (append-only) | staleness + liveness sweep, 15 s cadence |
| Resident textures after 50 open/close cycles | 50 (never freed) | **0** |
| Map growth over cycles | unbounded | **stabilises** |
| GPU texture disposal on eviction | no | yes |
| `ImageBitmap` close | no | yes, after 60 s |
| Video element teardown | no | pause + src release + element removal |

**Caveat:** these are **logic-level** measurements on the real code, not browser heap measurements. Actual JS heap and GPU texture counts could not be sampled — no browser. With the current 8 projects (28 images, 15 videos) the ceiling is not reached, so **no visual change is expected today**; the bound applies as you add projects.

---

## 4. Missing Resource Paths — **VERIFIED**

All three were confirmed **genuinely unrecoverable** — no `.ktx2` or `.glb` file exists anywhere in the repository. Nothing was invented.

| Path | Purpose | Finding | Resolution |
|---|---|---|---|
| `/basis/` | KTX2 transcoder directory | **Not required.** All 92 media URLs are `.jpg`/`.webp` from DatoCMS/Mux; zero `.ktx2` assets exist. | `ktx2()` now resolves `null` explicitly. No loader import, no network request. |
| `/textures/manifest.json` | compressed-texture manifest | **Not required.** No compressed textures ship. | `manifest()` now returns `{}` explicitly. No network request. |
| `/models/award.glb` | award 3D model | **Unavailable.** No `.glb` in the repo. | Procedural trophy fallback **preserved unchanged** (`rg(.4,1,6)`), now **intentional**: `SF=null` + `if(SF)` guard, so no request fires. Set `SF` to a path to restore the model later. |

**Behaviour is identical** — the old code always ended up at `null`/`{}`/fallback anyway, just via two guaranteed-failing network requests and a swallowed GLTF parse error. Those requests are now gone.

Verification: `"/basis/"` 0 occurrences, `/textures/manifest.json` 0, `/models/award.glb` only inside an explanatory comment. Syntax valid.

---

## 5. Soft-404 Correction — **VERIFIED**

### The defect
Every unmatched path returned `site_build/index.html` with **HTTP 200**, regardless of requested type.

### The fix
The unconditional SPA fallback was **removed entirely**. Every route is a real pre-rendered file, so no fallback is needed. Resolution is now: real file → serve; real directory with `index.html` → serve that; anything else → genuine **404** with a minimal styled 404 document.

The server now distinguishes:
- **Valid app routes** → 200
- **Static assets** (`/_nuxt/*`, `/_payload.json`, images, fonts, WASM) → 200 with correct MIME
- **API paths** (`/api/*`) → 404 (no endpoint exists)
- **Unknown URLs** → 404

### Test results — 13 paths, all genuine 404, **zero homepage leakage**

| Path | Before | After |
|---|---|---|
| `/nonexistent-page` | 200 (homepage) | **404** |
| `/robots.txt` | 200 (homepage) | **404** |
| `/sitemap.xml` | 200 (homepage) | **404** |
| `/llms.txt` | 200 (homepage) | **404** |
| `/api/subscribe` | 200 (homepage) | **404** |
| `/textures/manifest.json` | 200 (homepage) | **404** |
| `/models/award.glb` | 200 (homepage) | **404** |
| `/basis/` | 200 (homepage) | **404** |
| `/_nuxt/missing.js` | 200 (homepage) | **404** |
| `/missing.png` | 200 (homepage) | **404** |
| `/projects/` | 404 | **404** |
| `/projects/dothings` | 200 (homepage) | **404** |
| `/foo/bar/baz` | 200 (homepage) | **404** |

Each response was checked for the homepage marker string — **0 matches**.

All 10 valid routes still return 200 and survive direct URL access and refresh.

---

## 6. Newsletter Removal — **VERIFIED**

Removed completely, from every layer:

| Layer | Action |
|---|---|
| Homepage nav link | `<li><a href="/newsletter">Newsletter</a></li>` removed |
| Newsletter overlay panel (all 10 pages) | Entire `<div inert …>` block containing the form, copy, status region and honeypot removed — **2 585 bytes per page** |
| Newsletter CTA button (all 10 pages) | `<button …>Newsletter</button>` removed |
| `/newsletter` page | `site_build/newsletter/index.html` + `_payload.json` **deleted** |
| Submission handler | `he=async()=>{…}` → `he=async()=>{};` |
| `/api/subscribe` call | **0 occurrences remain** in the entire bundle |
| Fake success message | `y={subscribed:"On the list. Talk soon.",pending:"…"}` → `y={subscribed:"",pending:""}` |
| Server route | `/newsletter` now **404** |

**Layout preserved:** the newsletter overlay was a `position:fixed` + `inert` + `pointer-events:none` element, and the CTA was `position:absolute`. Neither participated in document flow, so removing them leaves the surrounding homepage layout and spacing untouched. The **About panel was preserved on all 10 pages** (verified: `77 awards` present everywhere).

Final counts: **0** HTML files containing "newsletter", **0** `<form>` elements, **0** `aria-label="Subscribe"`, **0** `api/subscribe` references.

---

## 7. Files Modified

| File | Change |
|---|---|
| `server.js` | **Rewritten** — secure path resolution, denylist, realpath containment, 404 handling, method restriction, security headers (+199/−9) |
| `site_build/_nuxt/DZyj3ghP.js` | Resource-eviction methods + stamping + interval; `ktx2()`/`manifest()` explicit no-ops; award guard; newsletter handler + success text neutralised (+8/−4) |
| `site_build/index.html` | Fluid font-size rule; `--size` removed; newsletter panel + nav link + CTA removed |
| `site_build/full/index.html` | Fluid font-size rule; `--size` removed; newsletter panel + CTA removed |
| `site_build/projects/*/index.html` (8 files) | Fluid font-size rule; `--size` removed; newsletter panel + CTA removed |
| `site_build/newsletter/index.html` | **Deleted** |
| `site_build/newsletter/_payload.json` | **Deleted** |

**Total: 14 files changed, 199 insertions, 109 deletions.** Build size 2.9 MB → 2.8 MB; 38 → 36 files.

**Not modified:** any shader, any animation constant (`IB`, `OU`, `GB`, `VB`, `WB`, `jo`, `G0`, `FF`, `W0`, `BF`, etc.), any WebGL material, any project transition, the GSAP choreography, the reflection floor, the trail simulation, or the card geometry.

**Preserved:** `WEBSITE-COMPLETENESS-AUDIT.md` and `BUG-PERFORMANCE-STABILITY-AUDIT.md` (untracked documentation, untouched).

---

## 8. Tests Performed

| # | Test | Result |
|---|---|---|
| 1 | Path traversal — 21 payloads incl. encoded, backslash, double-encoded, NUL | **PASS** — 0 leaks |
| 2 | Symlink escape (realpath containment) | **PASS** — enforced in code path |
| 3 | Hidden-file / private-file access (`.git`, `.env`, `package.json`) | **PASS** — 403 |
| 4 | Directory listing | **PASS** — impossible; no index → 404 |
| 5 | All 10 valid routes return 200 | **PASS** |
| 6 | 13 invalid routes return genuine 404, no homepage HTML | **PASS** |
| 7 | Static assets (JS/WASM/font/PNG/JSON) correct MIME + 200 | **PASS** |
| 8 | HEAD / OPTIONS / POST / PUT / DELETE / PATCH | **PASS** — 200 / 204 / 405 |
| 9 | JS syntax — all 12 chunks + `server.js` via `node --check` | **PASS** |
| 10 | HTML tag balance — all 10 pages parsed | **PASS** — all balanced |
| 11 | Resource eviction — 22 assertions on real shipped code | **PASS** — 22/22 |
| 12 | 50 open/close cycles → memory stabilisation | **PASS** — resident 50 → 0 |
| 13 | Catalogue protection (`this.items` untouched) | **PASS** |
| 14 | Newsletter absence (HTML/JS/routes) | **PASS** — 0/0/404 |
| 15 | About panel preserved on all 10 pages | **PASS** |
| 16 | 23 project records + 8 case studies intact | **PASS** |
| 17 | Prev/next navigation labels correct | **PASS** — all 8 verified |
| 18 | 650 px continuity — 300→1600 px sweep | **PASS** — max step 0.0263 px |
| 19 | Mobile/desktop font-size parity | **PASS** — delta 0.000 |
| 20 | Rendered layout inspection at each width | **NOT RUN** — no browser |
| 21 | Runtime heap / GPU texture sampling | **NOT RUN** — no browser |
| 22 | WebGL shader compilation / visual regression | **NOT RUN** — no browser |

---

## 9. Resource Measurements — Before vs After

| Metric | Before | After |
|---|---|---|
| Texture eviction calls in bundle | 0 | guarded sweep, 15 s cadence |
| Video teardown | none | pause + src release + element removal |
| GPU texture disposal on eviction | no | yes |
| `ImageBitmap` close | no | after 60 s unused |
| Resident textures after 50 open/close cycles | 50 | 0 |
| Map growth | unbounded | stabilises |
| Guaranteed-failing requests per page load | 3 (`/basis/`, manifest, `.glb`) | **0** |
| Newsletter network calls | 1 per submit | 0 |
| Bundle size | 1,144,471 B | 1,145,260 B |

---

## 10. Responsive Results

| Width | Root px | Body px | Matches original? |
|---|---|---|---|
| 320 | 8.205 | 11.487 | ✅ identical |
| 360 | 9.231 | 12.923 | ✅ identical |
| 390 | 10.000 | 14.000 | ✅ identical |
| 430 | 11.026 | 15.436 | ✅ identical |
| 640 | 16.410 | 22.974 | ✅ identical |
| 649 | 16.641 | 23.297 | ✅ identical |
| 650 | 16.667 | 23.333 | 🔧 **was 5.000 / 7.000** |
| 651 | 16.640 | 23.296 | 🔧 continuous |
| 680 | 15.877 | 22.228 | 🔧 continuous |
| 768 | 13.562 | 18.987 | 🔧 **was 5.120 / 7.168** |
| 1024 | 6.827 | 9.557 | ✅ identical |
| 1440 | 9.600 | 13.440 | ✅ identical |
| 1920 | 12.800 | 17.920 | ✅ identical |
| 2560 | 17.067 | 23.893 | ✅ identical |

Breakpoint discontinuity: **−11.641 px → +0.026 px**. Maximum per-pixel step across 300–1600 px: **0.0263 px**.

---

## 11. Production Build Status

| Check | Status |
|---|---|
| Build output complete | ✅ 10 pages, 12 chunks, WASM, font, payload |
| All chunks syntax-valid | ✅ `node --check` on 13 files |
| Broken imports | ✅ none |
| WASM served correctly | ✅ `application/wasm`, 527,333 B |
| Font served correctly | ✅ `font/woff2`, 115,148 B |
| Direct URL access / refresh | ✅ all 10 routes |
| Security headers | ✅ `nosniff` + `Referrer-Policy` added |
| Path traversal | ✅ **fixed** |
| Soft-404 | ✅ **fixed** |
| Missing asset requests | ✅ **eliminated** |
| Newsletter | ✅ **removed** |
| Compression / caching | ⚠️ **still absent** — `server.js` sends no `Content-Encoding` or `Cache-Control`. Not in scope for this task; recommend serving via a CDN or adding gzip + immutable cache headers for `/_nuxt/*`. |
| HTTP frame protection | ⚠️ deliberately not set (would break the preview iframe) |

**Note:** this repository has **no build step** — it is a static export. There is no `npm run build` to run; the artifacts *are* the build. "Production build success" here means the artifacts are internally consistent and serve correctly, which is verified.

---

## 12. Remaining Limitations

1. **No rendered-layout verification.** Phase 2's numbers are exact but the visual result at 649/650/651 px was not seen. One screenshot pass is needed.
2. **No runtime memory sampling.** Eviction is proven at logic level (22 assertions, 50-cycle stabilisation), not by heap/GPU measurement.
3. **No visual regression check** on the WebGL layer. No shader, material or animation code was modified, but this is unverified by rendering.
4. **`this.items` is intentionally never evicted.** It is the project catalogue. If you add hundreds of projects, the catalogue itself grows — by design, not by leak.
5. **Eviction ceiling is not reached at current content size** (28 images / 15 videos). The bound becomes active as you add projects.
6. **Compression and cache headers still missing** from `server.js` (deployment-level, out of scope).
7. **Award model is a procedural primitive**, not the original trophy — the original `.glb` does not exist in the repository. Set `SF` to a path to restore.
8. **The `DJ70QaFT.js` KTX2 loader chunk is still shipped** but no longer imported. Harmless (dead code); can be pruned in a future build.
9. **`basis_transcoder.VXdx5NbI.wasm` still shipped** but unreferenced by the app now. Harmless.
10. **Audit reports remain untracked** — commit them if you want them in history.

---

## 13. Summary of Corrections

| # | Correction | Status |
|---|---|---|
| 1 | Path traversal | **VERIFIED** — 21 payloads, 0 leaks |
| 2 | 650 px breakpoint | **PARTIALLY VERIFIED** — arithmetic exact, rendering unconfirmed |
| 3 | Resource eviction | **PARTIALLY VERIFIED** — 22/22 logic tests, runtime unmeasured |
| 4 | Missing resource paths | **VERIFIED** — 0 failing requests, fallbacks explicit |
| 5 | Soft-404 | **VERIFIED** — 13 paths → genuine 404 |
| 6 | Newsletter removal | **VERIFIED** — 0 traces, route 404 |

**Visual and animation systems were not modified.** Every shader, material, GSAP timeline, transition constant, reflection setting and geometry remains byte-identical apart from the four resource-lifecycle methods and the three no-op fallbacks documented above.

---

# ADDENDUM — Homepage Black-Screen Regression

**Status: root cause confirmed and fixed. Static verification complete. Visual confirmation pending — see §A.7.**

## A.1 The regression

After Phase 6 (newsletter removal) the homepage `/` rendered **black in the main area** while the
prerendered HTML HUD (nav, labels, frame) still displayed. No console-visible network failure:
every chunk, the WASM transcoder and the font returned `200`.

## A.2 Root cause — **the `onMounted` registration was deleted by the Phase 6 patch**

`site_build/_nuxt/DZyj3ghP.js`, app `setup()` (`__name:"app"`), byte offset ≈ 1,117,075.

The Phase 6 patch replaced the newsletter `he` handler. Its replacement span ended at the
handler's closing `};`, but the replacement text also **consumed the immediately following
`return Rn(`**.

Original (`git show HEAD:…`):

```js
he=async()=>{ … };return Rn(async()=>{ i.mount(a.value), … await i.boot(w,c) … }),Ni(()=>{…})
```

After the over-wide Phase 6 patch:

```js
he=async()=>{};async()=>{ await ti(); … }),Ni(()=>{…})
```

`Rn` is this bundle's **`onMounted`** registration. With `return Rn(` gone, the mount callback
was never registered with Vue, so it **never ran**. That callback is the entire GL boot chain:

```js
i.mount(a.value)      // create renderer, WebGL2 context, stage, resize observers
await i.boot(w,c)      // build scene, floor, reflections, load first project
i.preload(...)         // gallery textures
i.bootRelease()        // release the intro curtain
i.warmRain(); i.preloadAll(w)
```

None of it executed. The `<canvas>` was never created, so the gallery, cards, floor and
reflections were absent, while the HUD — which is prerendered into `index.html` — still showed.
That is exactly the reported screenshot: **HUD present, main area black.**

The bundle still parsed cleanly, so `node --check` passed and the production artifact looked valid.
**The defect was semantic, not syntactic** — the stray `)` balanced against an enclosing paren.
This is why a passing build did not imply a working app.

## A.3 The fix — one token, one occurrence

```
- he=async()=>{};async()=>{
+ he=async()=>{};return Rn(async()=>{
```

Applied as an asserted single occurrence (`count == 1`). Nothing else in the boot chain was touched.

Verified after the patch:

| Landmark | Original | Patched |
|---|---|---|
| `return Rn(async()=>{` | 3 | **3** |
| `Rn(` total | 15 | **15** |
| `Ni(` total | 11 | **11** |
| `i.mount(a.value)` context | — | **byte-identical to HEAD** |
| `await i.boot(w,c)` context | — | **byte-identical to HEAD** |

## A.4 Second latent defect found while verifying the fix — **eviction would have destroyed visible textures**

Auditing Phase 3 against the *real* object shapes in the bundle (not assumed ones) exposed that
`liveTextures()` — the function that decides which textures are safe to evict — **could not see
most live textures**:

- `scan()` returns **registry entries** shaped `{mesh: plane}` (`spawn()` → `{mesh:i}`), so the old
  check `o.texture` was always `undefined` for every card.
- `this.page` holds **raw meshes/planes** (`a.material.uniforms` is read directly on its elements
  in the bundle), so they were invisible to the old scan too.
- Uniform names were hardcoded (`u_texA`/`u_texB`/`u_texture`), so any material using another
  name was unprotected.

Consequence: 15 s after load, `evictStale()` would have **disposed textures that were on screen**,
producing blank/vanishing project cards — a second black-image bug waiting behind the first.

Corrected `liveTextures()`:

- **Generic texture detection** instead of hardcoded uniform names — a uniform value counts as a
  texture if `isTexture === true`, or it exposes `dispose()` and carries `image` / `isRenderTargetTexture`.
- Scans **all** uniform maps on `o.material`, `o.mesh.material` and `o.plane.material`.
- Covers **12 containers**: `content, page, overlay, texts, hud, pills, rings, awards, leaving,
  cards, blastRows, flights` — plus `rail.items`, `reg.all()`, `hero`, `pendingTitle`,
  `titleHero(.plane)`, `titleFly(.plane)`.

Two further hardening fixes:

- **`null`/`undefined` map entries** were skipped but never dropped, so they still counted toward
  the 64-texture cap and could force a spurious cap hit that evicts live textures. Now dropped.
- **Duplicate timer guard**: `mount()` now clears any existing `_evict` interval before setting a
  new one, so a remount cannot leak a second 15 s timer.

## A.5 Eviction test results — **23/23 passed**, against real bundle object shapes

| Group | Case | Result |
|---|---|---|
| A | `this.page` = raw meshes → `u_texture` seen as live | PASS |
| B | registry entries `{mesh: plane}` | PASS |
| C | card instances, both `u_texA`/`u_texB` | PASS |
| D | **all 12 containers** wired | PASS |
| E | `hero`, `pendingTitle`, `titleHero.plane`, `titleFly.plane` | PASS |
| F | `rail.items` | PASS |
| G | true orphan evicted + ImageBitmap closed | PASS |
| H | playing video protected, idle video released | PASS |
| I | live (playing) video texture never disposed | PASS |
| J | cap backstop; **live textures never evicted even over cap** | PASS |
| K | young (<8 s) protected; degenerate state does not throw | PASS |
| L | catalogue `this.items` untouched | PASS |
| M | 50 open/close cycles → resident 50 → **0** | PASS |

## A.6 Full regression sweep after the fix — all green

| # | Check | Result |
|---|---|---|
| 1 | Served bundle == disk bundle | **identical**, 1,147,502 B, `application/javascript` |
| 2 | 10 routes | **10 × 200** |
| 3 | 9 startup chunks (JS + font) | **9 × 200** |
| 4 | WASM `basis_transcoder` + woff2 | **200** `application/wasm` / `font/woff2` |
| 5 | Traversal, 22 payloads | **0 source leaks, 0 unexpected codes** |
| 6 | Genuine 404s, no soft fallback | `/nope`, `/newsletter`, `/projects/`, `/api/subscribe` → **404** |
| 7 | Unsafe methods | POST/PUT/DELETE/PATCH → **405** |
| 8 | Newsletter absence, 10 pages | **0 violations** |
| 9 | Project records in `_payload.json` | **23** (8 featured) |

Bundle diff vs `HEAD` is **4 changed lines, 7,897 → 7,897 lines** — no structural damage. The four
hunks map exactly to: Phase 4 award guard (+80 B), Phase 3 `texStamp` constructor (+74 B),
Phase 3/4 eviction + fallback methods (+2,027 B), Phase 6 newsletter removal (−527 B).

## A.7 What is NOT verified — read before judging the fix

**The gallery being visible is not confirmed by me.** This sandbox has no browser binary, no GPU
(`/dev/dri` absent) and every browser CDN is egress-blocked, so no frame was ever rendered here.
What *is* proven is that the code path which creates the canvas and builds the scene is registered
again, and that every asset it needs loads.

**The preview you are looking at is likely stale.** The screenshot supplied with this report shows a
`NEWSLETTER` nav item, but the served `index.html` contains **zero** newsletter strings and
`/newsletter` returns **404**. The iframe is rendering a cached document. **Hard-refresh before
judging the fix** (Ctrl/Cmd+Shift+R, or DevTools → Network → Disable cache).

Please confirm after a hard refresh: gallery visible, cards, floor + reflections, cursor
interaction, project open, project close, `FullIndex`, direct project routes, and refresh.

## A.8 Pre-existing, unrelated, not touched

- `site_build/favicon.ico` is an **HTML document with an `.ico` name** (identical to `HEAD`). The
  server serves it correctly (`200`, `image/x-icon`, exact bytes); the file itself is malformed in
  the source artifact. Left alone per "do not delete unrelated assets".
- `/llms.txt` is `<link>`ed in the HTML but was never shipped → 404. Non-blocking.
- `/projects/` (bare directory) → 404. Pre-existing.
