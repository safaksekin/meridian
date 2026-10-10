# Meridian — project handoff

Talk to the user in **Turkish**. They delegated product decisions ("product owner sensin"): make routine calls yourself, explain briefly, keep going.

## What this is
Meridian: a free, static, daily geography puzzle site with six modes. Live at https://safaksekin.github.io/meridian/ (repo github.com/safaksekin/meridian, public). Day #1 = 2026-10-10.

| id | TR name | Mechanic |
|---|---|---|
| beeline | Düz Çizgi | Start city + bearing; name the first 5 countries a great circle enters (Wordle tiles, 6 rows) |
| streets | Sokak İzi | Guess the city from a rotated 3 km OSM street crop; hints unlock per miss |
| mental | Zihin Haritası | Place 7 countries on a blank canvas; Procrustes fit; bias readout (tilt, N–S squash) |
| headcount | Nüfus Çemberi | Drop a circle of radius R holding the target population (GHSL grid), 3 tries |
| hinterland | Taşra | Guess the country from village names (ambiguous → giveaway order) |
| tripoint | Üçlü Nokta | Border lines meeting at a tripoint; name the 3 countries, 4 tries |

## Hard rules (from the user)
- **Zero cost.** Static hosting only, open data, no paid APIs, no backend. No surprise bills — never add Workers/Functions or paid services without asking.
- **No fake data.** No invented player counts or leaderboards. A real global leaderboard needs a backend: user decision, not built.
- **Practical, single-screen, short games.** Multi-round formats and film/TV themes were rejected; Turkey-only scope rejected (global audience).
- **Design:** home follows the user's own reference (photo cards, relief-map hero, nav). User REJECTED Playfair Display + Space Mono ("AI slop"); current type is Archivo (expanded heavy headings) + Archivo Narrow (labels). Ivory vs. cool-gray background: user doesn't mind. Daily-changing card art is unnecessary. Phones: cards stay 3 × 2.

## Stack & layout
Vite 7 + TypeScript strict, vanilla DOM, d3-geo, topojson. Hash routing (`#/beeline`).
- `src/main.ts` router · `src/home/` home, header (`chrome.ts`), card art (`cardart.ts`)
- `src/modes/<id>/` one folder per game (contract in `src/modes/types.ts`, guide in `docs/MODE_GUIDE.md`)
- `src/core/` daily seed, storage/stats, i18n (TR/EN via `makeT`), UI kit, progression (`progress.ts`: XP/levels/streak from local stats), friend challenges (`challenge.ts`: `?ch=` share links)
- `scripts/build-<id>.mjs` pre-generate puzzles into `public/data/<id>/`; `scripts/build-images.mjs` (NASA PD / CC0 artwork via macOS `sips`); `scripts/build-art.mjs` (mental card SVG)
- `data-raw/` raw downloads (git-ignored): `npm run data:fetch`

## Commands
```
npm run dev          # local dev server
npm test             # node --test (71 tests)
npx tsc --noEmit     # type-check
npm run deploy       # build + publish dist/ to gh-pages (GitHub Pages)
npm run deploy:cf    # Cloudflare Pages copy (project meridian-geo) — not reachable from Turkey
```
Deploying to GitHub Pages and pushing to `main` is the normal workflow the user approved. Commit messages end with the Co-Authored-By line from the system reminder.

## Testing in a real browser
Verify UI changes in headless Chromium (Playwright) at 390 px and 1280–1440 px, light and dark, Turkish UI (`localStorage['meridian:pref:lang'] = '"tr"'`): no console errors, no horizontal overflow, play each touched mode to the end and reload (state must restore). Install Playwright in a temp folder, not in package.json.

## Hosting facts
- `*.pages.dev` and `*.workers.dev` do not load from the user's network in Turkey; `github.io` works. That's why GitHub Pages is primary.
- wrangler ≥ 4.108 delegates agent-created static Pages projects to Workers unless `--force`; `meridian-geo` was created with `--force` so it stays on Pages.
- If the site grows: buy a domain (meridianle.com looked free on 2026-10-10) and point it at Cloudflare Pages.

## Current state (2026-10-10)
- All six modes done, browser-tested, live. `TEST_MODE = true` in `src/core/config.ts` (daily limit off, test toolbar with prev/next/random/replay; practice rounds never touch stats). **Set to false before public launch.**
- Share texts use English brand names ("Meridian Beeline #12") in both languages, by design.

## Next steps / open items
1. User wants to keep polishing the front end first; then I (the agent) draft listing posts for daily-game directories (dles.neocities.org, Listdle, BestDle) and Reddit (r/geography, r/geoguessr, r/travle) — only when the user says go.
2. Before launch: `TEST_MODE = false`, final name/domain decision ("Meridian" is a working title; common brand name).
3. Streetprint: ~39 planned crops never downloaded (Overpass rate limits). Re-run `node scripts/build-streets.mjs` (no `--offline`) to fetch them; cache lives in `data-raw/streets/overpass`.
4. Tripoint has 152 puzzles (cycles); others have 400+.
5. Headcount grid is decoded twice when a player goes home → game (minor).
6. Hinterland: some Palestine puzzles may include settlement names GeoNames files under PS — left as is.
