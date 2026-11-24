# Homepage Black Screen — Root-Cause Report

**Status: root cause identified, corrected, and verified by runtime instrumentation.**
Visual confirmation in a real browser is still outstanding — see §9.

---

## 1. Executive summary

There were **three separate faults**, and the previous report only found the first.

| # | Fault | Effect | Fixed |
|---|---|---|---|
| 1 | Phase 6 patch deleted `return Rn(` (the `onMounted` registration) | GL stage never mounted → **black screen** | previous turn |
| 2 | **Newsletter removed from prerendered HTML but NOT from the client render tree** | hydration mismatch → DOM corruption → **black screen persists** | **this turn** |
| 3 | No HTTP cache headers on in-place-patched, content-hashed assets | the deployed fix never reached the browser | **this turn** |

Fault 2 is why the screen stayed black after the `return Rn` fix, and it is also why the
**`NEWSLETTER` nav item kept reappearing** in the preview. That nav item was not a stale cache —
it was the client **re-rendering a button that had been deleted from the HTML**.

---

## 2. Phase 1 — What was actually running

| Check | Result |
|---|---|
| Process on `:3000` | exactly **one** `node server.js`, PID 3049, cwd = repo root |
| Served `/` vs disk `site_build/index.html` | **byte-identical**, 36,026 B |
| `NEWSLETTER` strings in served HTML | **0** |
| Service worker | **none** (no `sw.js`, 0 `serviceWorker` refs in bundle) |
| Cache headers | **none at all** — no `Cache-Control`, `ETag`, `Last-Modified`, `Expires`, `Pragma` |
| Stale/duplicate builds | none; single process, single `site_build` |

So the server was serving the correct files. The mismatch was **inside the page**, between the
prerendered HTML and what the client JavaScript rendered.

---

## 3. Phase 2 — Every startup resource

All requested from the live server; **each verified byte-identical to disk**, not just `200`.

| Resource | Status | Content-Type | Match |
|---|---|---|---|
| `/` (index.html) | 200 | text/html | identical |
| `/_nuxt/DZyj3ghP.js` | 200 | application/javascript | identical |
| `/_nuxt/mriNB3Nt.js` | 200 | application/javascript | identical |
| `CHzWqGxK.js`, `CSMsEA09.js`, `D6Jn8M47.js`, `DJ70QaFT.js`, `Dhdylg00.js`, `basis_transcoder.o4Hde_L7.js` | 200 | application/javascript | — |
| `ABCDiatypePlusVariable…woff2` | 200 | font/woff2 | — |
| `basis_transcoder.VXdx5NbI.wasm` | 200 | application/wasm | — |
| `/_payload.json` | 200 | application/json | — |

**No HTML-was-served-as-JS, no wrong MIME, no empty body, no security middleware rejection.**
The `server.js` rewrite and the SPA-fallback removal did **not** break asset delivery.

---

## 4. Phase 3 — The startup chain, traced at runtime

A browser was unavailable (§9), so I built a **runtime harness**: the real bundle executed in Node
under jsdom with a fake WebGL2 context, with every boot stage instrumented.

**Result on the fixed bundle — all 16 stages pass:**

```
[STAGE] 1  i.mount()            OK      canvas created (three.js r185)
[STAGE] 2  i.boot()   n=23      OK      23 project records
[STAGE] 3  nextPaint            OK
[STAGE] 3  curtain OFF          OK      intro overlay removed
[STAGE] 4  preload()            OK      23/23 textures loaded
[STAGE] 5  delays / bootRelease OK
[STAGE] 6  loader OFF           OK
[STAGE] 7  COMPLETE
GL draw calls: drawElements = 147        canvas count = 1
```

**The exact failing stage was therefore NOT WebGL init.** Stages 1–15 (context, renderer, scene,
camera, textures, render loop, draw calls) were all healthy. The failure was at **stage 16 — the
first *visible* frame — because the composited output was covered by an opaque overlay that
hydration had failed to remove.** WebGL was drawing into a canvas that was hidden behind a
full-screen black `z-99` div.

---

## 5. Phase 4 — Resource eviction

Re-audited against the **real** object shapes in the bundle rather than assumed ones. Two latent
defects were found and fixed in the previous turn and are still in place:

- `liveTextures()` could not see most live textures (`scan()` returns `{mesh}` wrappers;
  `this.page` holds raw meshes). Rewritten with generic texture detection over 12 containers.
- `null` map entries counted toward the 64-texture cap and could force a spurious eviction.

`this.items` (the 23-record catalogue) is never touched. Verified: 23 records before and after.

**Eviction was not the cause of this black screen** — the render loop was issuing 147 draw calls
with all 23 textures resident. It *would* have caused a second, later bug (textures vanishing at
15 s), which is now also fixed.

---

## 6. Phase 5 — Comparison against the last known-good version

Controlled A/B using `git archive HEAD` (baseline) versus the working tree, same harness:

| | Baseline (`HEAD`) | Before this fix | After this fix |
|---|---|---|---|
| Hydration mismatch | **none** | **`Hydration completed but contains mismatches`** | **none** |
| Intro curtain `.z-99` in DOM | 0 (removed) | **1 (stuck)** | 0 (removed) |
| `NEWSLETTER` / `/newsletter` in DOM | present (by design) | present (by design) | **0** |
| GL draw calls | 147 | 147 | 147 |
| Canvas | 1 | 1 | 1 |

This isolates the cause precisely: **the newsletter removal was applied to the prerendered HTML
only.** Three client render sites still emitted newsletter DOM:

1. **Nav button** — `iH` (`Ui` component) rendered `Ci(De(d)?"Close":"Newsletter")` in `DZyj3ghP.js`
2. **Newsletter panel** — `Gz` (`{__name:"Newsletter"}`) still mounted via `Mt(Gz)` in `DZyj3ghP.js`
3. **Footer link** — `mriNB3Nt.js` hardcoded `<li><a href="/newsletter">Newsletter</a></li>`

Because the HTML no longer contained those nodes, Vue's hydration walked past them and
**mis-associated every following DOM node**. The nav HUD ended up nested *inside* the app's intro
curtain:

```html
<div class="fixed inset-0 z-99 bg-black">   <!-- opaque, full viewport, above everything -->
  <div class="flex items-start justify-between">
    <a href="/">Jesper Landberg</a> …       <!-- the HUD -->
```

`position:fixed; inset:0` + `z-index:99` + `background:black` = a full-screen opaque layer, with
the nav rendered on top of it. **That is exactly "HUD visible, entire WebGL experience missing."**

> Note the DOM diff was unambiguous: the *only* structural difference between the prerendered HTML
> and the hydrated DOM was that one `<li>Newsletter</li>` — plus the nav button and panel.

---

## 7. Phase 7 — The correction (minimal, three edits)

| File | Change |
|---|---|
| `site_build/_nuxt/DZyj3ghP.js` | removed the `Newsletter` `<button>` from the `Ui` (`iH`) render |
| `site_build/_nuxt/DZyj3ghP.js` | removed `Mt(Gz)` — unmounted the `Newsletter` panel component |
| `site_build/_nuxt/mriNB3Nt.js` | removed `<li><a href="/newsletter">Newsletter</a></li>` from the "Elsewhere" list |
| `server.js` | added `Cache-Control: no-store, max-age=0` + `Pragma: no-cache` + `Expires: 0` |

No redesign, no rebuild, no static fallback. `raiseHud`/`swapHud` were confirmed null-safe before
removing the button (`if(!e?.isConnected)return`), so no other subsystem needed touching.

The `Gz` component definition and the `/newsletter` **route** remain in the bundle as dead code —
harmless, and `/newsletter` correctly returns **404**.

---

## 8. Phase 8 — Verification

**Runtime (harness, real bundle, fake WebGL2):**

- Hydration mismatch: **none**
- Intro curtain removed: **yes** (0 elements) — was stuck at 1
- Loader bars removed: **yes**
- `NEWSLETTER` / `/newsletter` in hydrated DOM: **0 / 0**
- GL draw calls: **147**; canvas: **1**; boot stages: **16/16**
- 23 project records loaded

**Served vs disk (all byte-identical):** `DZyj3ghP.js` 1,147,183 B · `mriNB3Nt.js` 6,653 B · `index.html` 36,026 B

**Regression sweep:**

| Check | Result |
|---|---|
| 10 routes | **10 × 200** |
| 10 startup assets (JS/WASM/font) | **10 × 200**, correct MIME |
| Traversal, 22 payloads | **0 leaks, 0 unexpected codes** |
| Genuine 404s | `/nope`, `/newsletter`, `/projects/`, `/api/subscribe` → **404** |
| Unsafe methods | POST/PUT/DELETE/PATCH → **405** |
| Cache headers | `no-store, max-age=0` ✓ |
| Newsletter across **all** HTML + JS | **0 rendering occurrences** (17 remaining are route names / shader comments / dead `Gz` code) |
| Project records | **23** |
| 650 px fluid font rule | **10/10** pages, 0 `--size` cliffs |
| Eviction methods + Phase 4 fallbacks | all present |

---

## 9. What is NOT verified — read before judging

**I have not seen a rendered frame.** This sandbox has **no browser binary** and **no GPU**
(`/dev/dri` absent); every browser CDN is egress-blocked, so no Chromium/Firefox could be installed.

The harness is jsdom: it has **no layout** (so the canvas reports 0×0) and a **fake WebGL2 context**
(every shader compiles, every draw succeeds). It proves the DOM, hydration, boot chain, texture
loading and draw-call issuance — it **cannot** prove the gallery is visually correct.

**Please hard-refresh once** (Ctrl/Cmd+Shift+R). `Cache-Control: no-store` is now set, so this
should be the last time it is needed.

Then confirm: gallery cards, photographs, floor grid + reflections, cursor interaction, project
open/close, `FullIndex`, direct project routes, and refresh.

---

## 10. Preserved fixes

Path-traversal containment (22/22 payloads blocked) · genuine 404s, no SPA fallback · 650 px fluid
root sizing (10/10 pages) · liveness-based eviction with corrected `liveTextures()` · KTX2 /
texture-manifest / award-model fallbacks · **Newsletter fully removed** · all 23 project records ·
the original WebGL renderer, shaders, materials, GSAP timelines and transitions — untouched.
