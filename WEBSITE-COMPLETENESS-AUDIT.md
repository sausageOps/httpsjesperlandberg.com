# Website Completeness & Production Readiness Audit

**Repository:** `sausageOps/httpsjesperlandberg.com`
**Branch audited:** `arena/a8cee66f-httpsjesperlandberg-com` (base `e27248e`)
**Reference site:** https://jesperlandberg.com/
**Audit date:** 2026-11-24
**Method:** Static analysis of all 65 tracked files, HTTP probing of the running server, decoding of the Nuxt/devalue payload, cross-check against the live production site, and Node syntax/import validation. No project files were modified and no dependencies were installed.

---

## 1. Overall Completeness Assessment

This repository is **not a source project — it is a build artifact dump plus a hand-written static file server**. It contains the pre-rendered output of a genuinely complete, production-grade website, but none of the source, none of the server layer, and none of the build/deploy configuration.

The single most important finding is a split verdict:

| Dimension | Status |
|---|---|
| Pre-rendered pages | **Complete** — 11/11 URLs match the live production `sitemap.xml` exactly |
| Content (projects, copy, metadata) | **Complete** — 23 projects, 8 full case studies, all verified as rendered |
| Client JS/CSS/font assets | **Complete** — no broken imports, all chunks present, all files pass `node --check` |
| Server layer (`/api/subscribe`, `/llms.txt`, `/robots.txt`, `/sitemap.xml`, `.md` negotiation) | **MISSING** — exists in production, absent from this repo |
| Source code / build pipeline | **MISSING** — no `package.json`, no `nuxt.config`, no `.vue`/`.ts` files; cannot be rebuilt |
| Deployment configuration | **MISSING** — no `netlify.toml`, `vercel.json`, `Dockerfile`, CI workflow, or `_headers`/`_redirects` |

**The site looks complete because it is a faithful capture of a complete website. It is not deployable as-is because the part of that website that runs on a server was never captured.**

---

## 2. Framework and Project Architecture

### What is actually in the repository

```
65 tracked files, 6.4 MB total (972 KB of that is .git)

site_build/                  38 files, 2.9 MB  <- the only real deliverable
  _nuxt/                     12 JS chunks + 1 WASM + 1 variable font
  index.html                 homepage (pre-rendered)
  full/index.html            full project index
  newsletter/index.html      newsletter
  projects/<slug>/index.html 8 case-study pages (+ matching _payload.json each)
  _payload.json              devalue-encoded Nuxt payload (750 nodes)
  face.png                   real PNG (47 KB, valid magic bytes)
  favicon.ico                NOT an icon — an HTML document (see §12)

server.js                    79-line zero-dependency Node static server

~20 unreferenced scratch files at repo root:
  body.html, full_page.html, original_page.html, project_page.html,
  payload.json, projects_parsed.json, style_0.css, style_1.css,
  nuxt_*.js (x7), assets_site/, ABCDiatypePlusVariable.woff2
```

### Framework stack (inferred from the built output)

| Layer | Technology | Evidence |
|---|---|---|
| Meta-framework | **Nuxt 3** (Vue 3 SSR + Nitro) | `_payload.json` devalue format, `_nuxt/` hashed chunks, `router-link-active` classes |
| Rendering | Static export (`nuxt generate`) | Every route has a real `index.html` + `_payload.json` |
| 3D / graphics | **three.js** + custom **GLSL** shaders | `THREE.WebGLRenderer`; 484 `uniform`, 177 `varying`, 67 `gl_FragColor`, 27 `gl_Position` |
| Texture compression | **Basis/KTX2** transcoder | `basis_transcoder.VXdx5NbI.wasm` (527 KB) + loader chunk |
| Animation | **GSAP** | Present in main chunk |
| CMS | **DatoCMS** (headless) | `https://graphql.datocms.com/` referenced in bundle |
| Media hosting | **DatoCMS Assets** + **Mux** | `datocms-assets.com`, `image.mux.com`, `stream.mux.com` |
| Styling | Tailwind (JIT, inlined) | Utility classes + `<style>` blocks with `--tw-*` variables |

### Architecture characteristics

- **Everything visual is drawn to canvas.** The homepage HTML contains **zero** `<img>`, `<video>`, and `<canvas>` tags. All imagery is loaded as WebGL textures at runtime; DOM text is mirrored via `data-gl="text"` spans.
- **Scroll is fully hijacked.** Global CSS: `body,html { overflow:hidden; position:fixed; touch-action:none }`. There is no native scrolling anywhere.
- **Responsive scale:** breakpoints at 650 / 1100 / 1300 / 1400 px; `--size` flips 390 → 1500; root font-size is `clamp(5px, 20px, 10*100vw/var(--size))`.
- **Entry points:** `site_build/index.html` (homepage) and `server.js` (the only executable).

---

## 3. All Functional Pages and Routes

11 pre-rendered pages exist. All were requested over HTTP and returned `200` with valid HTML.

| Route | Status | Bytes | `<title>` | Canonical |
|---|---|---|---|---|
| `/` | 200 | 38,690 | Jesper Landberg | `/` |
| `/full` | 200 | 35,755 | Index | `/full` |
| `/newsletter` | 200 | 38,786 | Newsletter | `/newsletter` |
| `/projects/the-lookback` | 200 | 31,045 | The Lookback | `/projects/the-lookback` |
| `/projects/nathan-riley` | 200 | — | Nathan Riley | `/projects/nathan-riley` |
| `/projects/casa-di-solare` | 200 | — | Casa Di Solare | `/projects/casa-di-solare` |
| `/projects/book-of-happiness` | 200 | — | Book of Happiness | `/projects/book-of-happiness` |
| `/projects/dogelon-mars` | 200 | — | Dogelon Mars | `/projects/dogelon-mars` |
| `/projects/gil-huybrecht` | 200 | — | Gil Huybrecht | `/projects/gil-huybrecht` |
| `/projects/discoveryland` | 200 | — | Discoveryland | `/projects/discoveryland` |
| `/projects/griflan` | 200 | — | Griflan | `/projects/griflan` |

**Route set vs. production:** the live `sitemap.xml` lists exactly these 11 URLs and no others. **No page is missing from the repo.**

**Routes that exist in production but are absent from the repo** (all return the homepage with HTTP 200 here — see §12):

- `/llms.txt` — present on the live site (verified, full Markdown document)
- `/robots.txt` — present on the live site (verified, declares the sitemap)
- `/sitemap.xml` — present on the live site (verified, 11 URLs)
- `/*.md` — every page on the live site is available as Markdown via `Accept: text/markdown` or `.md` suffix
- `/api/subscribe` — the live newsletter endpoint (confirmed by the live `/newsletter.md`: *"It posts an email address to `/api/subscribe` and confirmation is by email"*)

---

## 4. Working and Non-Working Interactions

### VERIFIED WORKING

| Interaction | How verified |
|---|---|
| Homepage loads at `/` | HTTP 200, valid HTML, correct title and meta |
| All 8 featured project cards link to real pages | Parsed `<a href>` from homepage; each target returns 200 with matching content |
| `/full` links 8 internal + 15 external projects | Parsed all anchors; internal targets resolve, external are the correct client sites |
| Previous / next project navigation | Real `<a>` elements with `aria-label="Previous project: …"` / `"Next project: …"`; ordering verified against featured sequence and wraps correctly |
| Featured / Full nav toggle | Real `<a>` to `/` and `/full` on every page; toggle buttons carry `aria-expanded` |
| Direct route access (deep link / refresh) | All 11 routes return their own pre-rendered document with 200 |
| Project page content correctness | For all 8: `<title>`, `og:title`, `meta description`, and `<h1>` all match the payload record |
| Semantic structure | 1 `<main>`, 1 `<nav>`, 1 `<h1>`, 2 `<h2>` per page; `lang="en"` |
| Structured data | JSON-LD `@graph` with `Person`, `sameAs`, `knowsAbout` present |
| Newsletter form accessibility | `role="status" aria-live="polite"` feedback region; `company` honeypot field with `tabindex="-1" aria-hidden="true"` |
| No broken runtime imports | All local specifiers resolve to real chunks; the two `.graphql` hits are DatoCMS error-message strings, not imports |
| No secrets in bundle | No API tokens, bearer strings, or credentials found |

### NOT WORKING

| Interaction | Status | Severity |
|---|---|---|
| **Newsletter submission** | **BROKEN — reports false success** | **CRITICAL** |
| Invalid-route 404 handling | BROKEN — soft 404 | MEDIUM |
| `/llms.txt` footer link on every page | BROKEN — target does not exist | MEDIUM |
| Favicon | BROKEN — file is HTML, not an icon | MEDIUM |

**Newsletter detail.** The form has no `action` attribute and is `novalidate`; it is handled in JS:

```js
const ie = await $fetch("/api/subscribe", { method: "POST", body: { email, company } });
D(ie?.pending ? "pending" : "subscribed");
```

There is no `/api/` route in this build and no handler in `server.js`. A POST returns **HTTP 200 with `Content-Type: text/html` and the homepage document** (verified empirically). `$fetch` therefore resolves with a string, `ie?.pending` is `undefined`, and the code falls through to `"subscribed"` — so the user is shown **"On the list. Talk soon."** while no email was ever recorded. This is silent data loss with a false success message, not a visible error.

> Caveat: the HTTP behaviour was verified directly; the success-path branch was established by reading the minified bundle. The JS could not be executed in a browser here (see §12 "Not tested").

---

## 5. Content and Asset Completeness

### Projects

| Metric | Value |
|---|---|
| Projects in payload | **23** |
| Featured (full case study) | **8** |
| Non-featured (name + external link only) | **15** |
| Image entries | 129 |
| Video entries | 51 |
| Unique media URLs | 92 |

The 15 projects without a case-study page are **intentional, not missing**. The `/full` page states: *"A featured project has a case study on this site; the rest are listed by name, with the client's own site linked where there is one."* Each of the 15 has a valid external link. This is a coherent editorial decision.

### Content verification per project page

All 8 case studies were checked against their payload record. **All 8 matched exactly** on title, `og:title`, description, and `<h1>`. No placeholder text, no "Lorem ipsum", no empty sections.

### Asset locality — the largest structural risk

| Asset class | Local | Remote |
|---|---|---|
| Font (`ABCDiatypePlusVariable.woff2`) | ✅ 115 KB | — |
| JS / WASM | ✅ 12 chunks + 527 KB WASM | — |
| `face.png` | ✅ 47 KB | — |
| **All project imagery** | ❌ **0 files** | 78 entries on `datocms-assets.com` |
| **All video posters** | ❌ **0 files** | 51 entries on `image.mux.com` |
| **All video streams** | ❌ **0 files** | 51 entries on `stream.mux.com` |
| Favicon | ⚠️ present but corrupt (HTML) | 13 remote `<link rel=icon>` variants |

**100% of the site's imagery and video is served from third-party CDNs. Nothing is bundled locally.** Without internet access — or if DatoCMS/Mux ever change or expire those URLs — the site renders as **text on a black background**: the font and layout survive, every image and every video is gone. There is no local fallback, no poster file, and no error placeholder.

### Other content observations

- Every image has `alt=""` (all 129). Defensible for decorative WebGL textures, but it means no imagery is described to assistive technology.
- 7 non-featured projects have no description (they are name-only entries by design).
- 0 projects are missing their `link`.
- The repo build's content **matches the live site exactly** (same 8 featured projects, same descriptions, same contact block), so the capture is not stale in content. The sitemap `lastmod` is 2026-09-07.

---

## 6. Backend and External Service Requirements

**Classification: this is a frontend-only static export that was extracted from a site which is *not* frontend-only.**

| Dependency | Required? | Present in repo? |
|---|---|---|
| DatoCMS GraphQL API | Build-time only (content baked into `_payload.json`) | N/A — already baked in |
| DatoCMS Assets CDN | **Runtime — yes** | ❌ external only |
| Mux (image + stream) | **Runtime — yes** | ❌ external only |
| `/api/subscribe` server route | **Runtime — yes** | ❌ **MISSING** |
| `/.md` content negotiation | Runtime — yes (production feature) | ❌ MISSING |
| `/robots.txt`, `/sitemap.xml`, `/llms.txt` | Runtime — yes | ❌ MISSING |
| Database | None | — |
| Authentication | None | — |
| Environment variables | None found, none documented | — |

**Simulated / hardcoded functionality:**
- The newsletter form is a **real, well-built frontend form wired to an endpoint that does not exist in this repo**. It is not a mock — the client code is genuine — but in this deployment it is a form that cannot work and cannot fail loudly.
- There is no authentication, no database, and no other write path. Nothing else is simulated.

**Important framing:** a frontend-only portfolio is *not* incomplete for lacking a database. This one is incomplete because its one and only server dependency was dropped, and because it depends on two third-party CDNs to display anything at all.

---

## 7. Responsive and Browser Testing Results

**No browser was available in the sandbox and dependencies were not installed, so no rendered-page testing could be performed.** Everything below is derived from static CSS/HTML analysis.

| Check | Result | Basis |
|---|---|---|
| Breakpoints defined | ✅ Present | `@media (min-width: 650/1100/1300/1400px)`, `hover:hover`, `hover:none` |
| Mobile scaling strategy | ✅ Defined | `--size: 390` mobile → `1500` desktop; `clamp(5px, 20px, …)` root font |
| Touch-specific styles | ✅ Present | `has-not-hover:` variants, `(hover:none) and (pointer:coarse)` |
| Pinch-zoom | ❌ **Blocked** | `body,html { touch-action: none }` globally |
| Text resizing on mobile | ❌ **Blocked** | `-webkit-text-size-adjust: none` |
| Reduced-motion support | ❌ **Absent** | 0 occurrences of `prefers-reduced-motion` in CSS *and* JS |
| Overflow / clipping risk | ⚠️ High by design | `overflow:hidden` + `position:fixed` + canvas-only visuals |
| Layout integrity at widths | **NOT TESTED** | No browser |
| Touch gestures | **NOT TESTED** | No browser |
| Animation behaviour | **NOT TESTED** | No browser |
| Media loading | **NOT TESTED** | CDN hosts blocked from sandbox |

For a site whose entire visual layer is WebGL with no `<img>` fallback, the absence of `prefers-reduced-motion` and the blocking of pinch-zoom and text resizing are the most consequential accessibility gaps.

---

## 8. Production Build Results

The repository **is** a production build (`nuxt generate` output). What it is not is a *reproducible* one.

| Check | Result |
|---|---|
| Build output present and complete | ✅ 11 pages, 12 chunks, WASM, font |
| JS syntax valid | ✅ All 13 files pass `node --check` |
| Broken imports | ✅ None (all local specifiers resolve) |
| Missing chunks referenced by HTML | ✅ None (12 referenced, all present) |
| Dead chunks on disk | ⚠️ 2 (`C4m1BJfK.js`, `basis_transcoder.VXdx5NbI.wasm`) — reachable only via dynamic import |
| Build scripts (`npm run build` etc.) | ❌ **MISSING** — no `package.json` |
| Source files (`.vue`, `.ts`, `nuxt.config`) | ❌ **MISSING** |
| Lockfile | ❌ MISSING |
| Ability to rebuild from this repo | ❌ **Impossible** |
| Minification / hashing | ✅ Applied |
| Sourcemaps | ❌ None shipped (fine for production) |
| Console errors / warnings | **NOT TESTED** — no browser |
| Runtime exceptions / hydration | **NOT TESTED** — no browser |
| WebGL shader compilation | **NOT TESTED** — no browser |
| Memory leaks / resource disposal | ⚠️ Partly reassuring: 120 `dispose()` calls, `deleteBuffer`, `deleteProgram`, `deleteShader`, `loseContext` present |
| Performance metrics | **NOT TESTED** |
| SEO metadata | ⚠️ Good but flawed — see below |
| Accessibility | ⚠️ Mixed — see §12 |

**SEO specifics:** titles, descriptions, Open Graph, Twitter cards, canonical tags, and JSON-LD are all present and correct. Two defects: `canonical` and `og:url` are **relative** (`/projects/griflan` instead of an absolute URL), which is invalid per the Open Graph spec and weakens canonicalisation; and `robots.txt`/`sitemap.xml` are absent (and would return HTML here).

---

## 9. Deployment Readiness

**Can this repository be deployed as a real website? Partly — and not without work.**

| Requirement | Status |
|---|---|
| Static files serve correctly | ✅ Yes — `site_build/` works on any static host |
| Absolute asset paths | ✅ Yes — all `/_nuxt/...` are root-relative |
| Direct route access | ✅ Yes — every route is a real pre-rendered file |
| SPA fallback needed | ⚠️ Not needed for the 11 real routes; needed only because of the soft-404 bug |
| `/api/subscribe` endpoint | ❌ **BLOCKER** — must be created as a serverless function |
| `/llms.txt`, `/robots.txt`, `/sitemap.xml` | ❌ Missing — must be generated |
| Environment variables | ⚠️ None required for the static bundle; none documented for the API |
| HTTPS / domain assumptions | ✅ None hardcoded (all internal URLs are relative) |
| Hosting compatibility | ✅ Any static host + one function for `/api/subscribe` |
| Deployment config | ❌ None (`netlify.toml`, `vercel.json`, `Dockerfile`, CI — all absent) |
| Custom 404 page | ❌ None |
| Security headers | ❌ None configured anywhere |

**The bundled `server.js` is not production-grade** and should not be used as the deploy target — see the path-traversal finding in §12.

**Bottom line:** the static page set is deployable today. The website as a whole is not, because its newsletter endpoint, its `llms.txt`/`robots.txt`/`sitemap.xml` surface, and its Markdown negotiation all live in a Nitro server layer that was never captured.

---

## 10. Missing Functionality

| # | Missing item | Impact | Severity |
|---|---|---|---|
| 1 | `/api/subscribe` server route | Newsletter cannot accept a single subscriber | **CRITICAL** |
| 2 | `/llms.txt` | Footer link on every page is dead; live site has it | MEDIUM |
| 3 | `/robots.txt` | No crawl directives; sitemap undeclared | MEDIUM |
| 4 | `/sitemap.xml` | No sitemap for search engines | MEDIUM |
| 5 | `.md` / `Accept: text/markdown` negotiation | Production feature entirely absent | LOW |
| 6 | Custom 404 page | No branded error state | LOW |
| 7 | Source code + build pipeline | Site cannot be modified, rebuilt, or maintained | **HIGH** (for the repo as a project) |
| 8 | Deployment configuration | No reproducible deploy path | MEDIUM |
| 9 | `prefers-reduced-motion` support | Motion-sensitive users have no relief | MEDIUM |
| 10 | `<noscript>` fallback | 0 occurrences — JS-disabled users get an inert page | LOW |
| 11 | Skip-to-content link | Absent | LOW |

---

## 11. Placeholder or Simulated Features

| Feature | Classification | Severity | Notes |
|---|---|---|---|
| Newsletter signup form | **PLACEHOLDER / SIMULATED** (in this deployment) | **CRITICAL** | Real client code, no backend. Renders **"On the list. Talk soon."** on success without recording anything. |
| "Featured" / "Full" nav | Real, working | — | Genuine `<a>` navigation |
| Previous / next project arrows | Real, working | — | Genuine links with correct `aria-label`s |
| Social / email links | Real, working | — | Correct external destinations |
| Project cards | Real, working | — | Real `<a>` with text content |
| WebGL canvas visuals | Real, but **unverifiable here** | — | Genuine three.js + GLSL; rendering not testable without a browser |
| All imagery / video | Real assets, **not local** | MEDIUM | Genuine CDN URLs, zero local copies |

**No fake buttons, no decorative non-functional controls, and no hardcoded demo data were found.** The site is not a mockup. Its one broken feature is broken by omission of infrastructure, not by being fake.

---

## 12. Critical Defects and Remaining Limitations

### CRITICAL

**C1 — Newsletter silently fails and reports success.**
`POST /api/subscribe` returns the homepage with HTTP 200 (`text/html`). The success branch runs on the string, so users see "On the list. Talk soon." while nothing is stored. The only write path on the site is non-functional *and* misleading. Reproduce: `curl -X POST -H 'Content-Type: application/json' -d '{"email":"a@b.com"}' :3000/api/subscribe`.

### HIGH

**H1 — Path traversal in `server.js`.**
`path.join(PUBLIC_DIR, pathname)` is applied to a decoded URL path with no containment check. Verified working:
```
GET /../server.js        -> 200, 2351 bytes, returns the server's own source
GET /_nuxt/../../server.js -> 200, same
GET /%2e%2e/server.js    -> 200, same
```
Any file readable by the Node process outside `site_build/` can be fetched. The bundled server must not be exposed.

**H2 — No source code or build pipeline.**
No `package.json`, `nuxt.config.*`, `.vue`, `.ts`, lockfile, or README. The site cannot be rebuilt, re-themed, or have so much as a typo fixed. Any content change requires regenerating the entire export elsewhere.

### MEDIUM

**M1 — Soft 404 on every unknown route.** The fallback in `server.js` serves `site_build/index.html` with **HTTP 200** for anything unmatched. Verified: `/nonexistent-page`, `/projects/dothings/`, `/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/api/subscribe` all return 200 + the homepage. Search engines index duplicate content; `/llms.txt` and `/robots.txt` return HTML instead of their own formats. Only `/projects/` correctly returns a bare `404 text/plain`.

**M2 — `favicon.ico` is an HTML document.** 17,656 bytes beginning `<!DOCTYPE html>`, served as `image/x-icon`. Browsers cannot parse it. All 13 real favicon variants point at DatoCMS.

**M3 — `/llms.txt` is linked in the footer of all 11 pages but does not exist.** The live site serves a complete Markdown document at that path; this repo serves the homepage.

**M4 — No `robots.txt` or `sitemap.xml`.** Both exist in production.

**M5 — No `prefers-reduced-motion` handling** anywhere in CSS or JS, on a site that is 100% motion and WebGL.

**M6 — Pinch-zoom and text resizing are disabled.** `touch-action:none` on `body,html` and `-webkit-text-size-adjust:none` globally. This blocks WCAG 1.4.4 (resize text) on mobile.

**M7 — 100% of imagery and video is remote.** No local copies, no fallbacks, no error states. The site degrades to text-on-black without DatoCMS and Mux.

**M8 — No deployment configuration of any kind.**

### LOW

- **L1** Newsletter email input uses `outline-none` with no replacement indicator — no visible keyboard focus ring on the only text field.
- **L2** No `<noscript>` fallback (0 occurrences).
- **L3** No skip-to-content link.
- **L4** `canonical` and `og:url` are relative URLs, not absolute.
- **L5** All 129 images have empty `alt`.
- **L6** No security headers anywhere: CSP, `X-Content-Type-Options`, `X-Frame-Options`, HSTS, `Referrer-Policy` all absent.
- **L7** `server.js` accepts PUT/DELETE/PATCH and returns 200 for all of them.
- **L8** ~20 unreferenced duplicate files at repo root (`body.html`, `full_page.html`, `original_page.html`, `project_page.html`, `payload.json`, `projects_parsed.json`, `style_*.css`, `nuxt_*.js` ×7, `assets_site/`, `ABCDiatypePlusVariable.woff2`). Verified byte-identical to their `site_build/` counterparts and referenced by nothing — pure repo noise.
- **L9** Two orphan chunks (`C4m1BJfK.js`, `basis_transcoder.VXdx5NbI.wasm`) not referenced by any HTML.
- **L10** No `<header>`/`<footer>` landmarks (divs used instead).
- **L11** Leftover scaffolding comments in `server.js` (`// If requesting /_payload.json` above unrelated code).

### NOT TESTED (and why)

No browser binary existed in the sandbox and the audit rules prohibited installing dependencies. The following are therefore **unverified, not assumed-good**:

- Actual WebGL rendering, shader compilation, canvas output
- Client-side hydration success or failure
- Console errors and warnings
- Video playback (Mux hosts are network-blocked from the sandbox)
- Real image loading from DatoCMS (network-blocked)
- Browser back/forward navigation
- Touch gestures and drag interactions
- Layout at specific viewport widths / breakpoint boundaries
- Runtime performance and memory behaviour
- Actual assistive-technology output

The `.graphql` "broken import" hits were investigated and are **false positives** — they occur inside DatoCMS error-message strings, not import statements.

---

## 13. Verdict

### **B — Mostly complete website with specific remaining issues**

### Why B, and not the others

**Not A (complete and production-ready).** Three things block it: the newsletter endpoint does not exist and silently lies about success (C1); the Nitro server surface that production depends on (`/llms.txt`, `/robots.txt`, `/sitemap.xml`, `.md` negotiation) is entirely absent; and there is no source or build pipeline, so the site cannot be rebuilt or maintained. It also ships a bundled server with a verified path-traversal vulnerability (H1).

**Not C (visual reconstruction with important functionality missing).** This is emphatically *not* a mockup. It is a byte-faithful static export of a real, award-winning production website. All 11 pages return correct, distinct, payload-matching content. The 8 case studies are complete. Navigation, prev/next, the full index, SEO metadata, JSON-LD, and structured accessibility attributes are all genuine and correct. No content is faked, and no control is decorative-but-dead. The page set matches the live sitemap 11-for-11, and the copy matches the live site exactly.

**Not D (incomplete prototype).** A prototype does not have 23 curated projects, 8 fully-written case studies, complete Open Graph/Twitter/JSON-LD metadata, a variable font, a WASM texture transcoder, or a working WebGL renderer with custom shaders. This is finished work.

**Why B.** The website's *content and client-side experience* are complete and production-grade. What is missing is *infrastructure and provenance*: one API route, four static server routes, the source tree, and any deployment configuration. Those are specific, enumerable, and fixable — which is precisely what "mostly complete with specific remaining issues" means.

### The honest one-line summary

> This repository contains a genuinely complete website's **rendered output**, not a complete **website project**. It will look perfect in a preview and fail in production the moment anyone tries to subscribe to the newsletter.

### To reach A

1. Restore `/api/subscribe` as a serverless function (and make the client fail loudly on non-JSON responses).
2. Ship `/llms.txt`, `/robots.txt`, `/sitemap.xml`, and the `.md` negotiation.
3. Add real 404 handling instead of the homepage fallback.
4. Replace the corrupt `favicon.ico`.
5. Add `prefers-reduced-motion` support and restore pinch-zoom / text resizing.
6. Commit the Nuxt source, `package.json`, lockfile, and a deploy config.
7. Do not deploy `server.js` as-is — fix the path traversal first.

---

## Appendix — Evidence Index

| Claim | How it was established |
|---|---|
| 65 tracked files, 6.4 MB | `git ls-files`, `du` |
| No source code | Checked for `package.json`, `nuxt.config.*`, `.vue`, `.ts`, lockfile, README — all absent |
| 23 projects, 8 featured, 15 non-featured | Decoded `_payload.json` devalue graph (750 nodes) |
| 129 images / 51 videos / 92 unique URLs / 100% remote | Walked decoded payload, grouped by host |
| All 8 project pages match payload | Compared `<title>`, `og:title`, description, `<h1>` per page |
| 11/11 routes match production | Live `sitemap.xml` fetched and diffed against `site_build` |
| Newsletter broken | `POST /api/subscribe` → 200 `text/html` homepage; success branch read from bundle |
| Soft 404 | Six unknown paths probed → all 200 + homepage |
| Path traversal | Four traversal payloads probed → all returned `server.js` source |
| Favicon is HTML | Magic bytes `3c21444f43545950` = `<!DOCTYPE` |
| No broken imports | Regex-extracted specifiers, resolved each against disk; `node --check` on all 13 files |
| No secrets | Pattern scan for tokens/bearer/credentials in all chunks |
| Server routes absent in production | Live `/llms.txt`, `/robots.txt`, `/sitemap.xml`, `/newsletter.md`, `/index.md` fetched and confirmed present |
| Media unverifiable | `curl` to `datocms-assets.com` / `mux.com` blocked by sandbox egress policy |
