# UNiaoer · Bird Identification Practice

The environment of our planet is deteriorating, and so is our health.

It is time to put down the phone, walk away from the computer, and go outside to watch birds and protect them!

UNiaoer has images or audio of 10000+ bird species to help you quickly get to know these lovely little chirpers.

(This is an open-source non-commercial project.)

Project description: learn to recognise birds from real photos and recordings, and browse a global bird catalogue with distribution data. Built for birders worldwide, with Chinese-first onboarding and full English support.

> **Non-commercial · Open source**
>
> UNiaoer is a **non-commercial open-source project**: free to use, no ads, no paid features, no data resale.
> **Code** is released under [MIT](./LICENSE); **images, audio and identification models are not covered by the code licence** and follow their own licences (see below). Any commercial use (including commercial integration, mirrors, or ad/subscription-funded redistribution) requires separate permission.

## Planned modes

> Design drafts only: **no code, question bank or UI has been written**; existing L1–L5 are unaffected.
> Common rules: 10 questions per round; **both Chinese and English UI are supported** — prompts and answers follow the current UI language (Chinese or English name); only species with a stable name are used; scoring and pool details are TBD.

### L6 · Half-birder (name → image / sound)

- **Photo version**: the prompt shows a bird's common name (Chinese or English, following the UI language, e.g. 「白鹡鸰」/ “White Wagtail”), with **6 image options** and a **10-second** limit.
- **Audio version**: same name prompt (Chinese or English), **4 sound options**, **25-second** limit (audio ID is harder, so more time).
- Goal: connect a name to its look/call — the reverse direction of the photo and audio quizzes.

### L7 · Bird Creator (image / sound → name, typed answer)

- **Photo version**: a bird photo on top, a text input below; type the bird's name and submit within **10 seconds** (Chinese or English, following the UI language).
- **Audio version**: a recording; type the name and submit within **12 seconds** (Chinese or English).
- Goal: move from multiple choice to **active recall (production)**, the hardest level. Start with exact matching in the current language plus common aliases / scientific names; pinyin and simplified/traditional tolerance are TBD.

## Tech stack

- Vue 3 + TypeScript + Vite
- Vue Router (route-level code splitting)
- Pinia (state management)
- Vitest + Vue Test Utils
- ESLint + oxlint + Prettier

## Data sources and licences

**Code** is released under [MIT](./LICENSE); **images, audio, open datasets and identification models are not covered by the code licence** and follow the licences below.

### Media (attributed item by item)

| Source | Usage | Licence and obligations |
|---|---|---|
| [iNaturalist](https://www.inaturalist.org/) (api.inaturalist.org) | Bird photos / some recordings | **Per-item CC** (CC0 / BY / BY-NC / BY-ND…, open licences only); every item shows author, licence and source link; ND items are served as-is, never transcoded |
| [Xeno-canto](https://xeno-canto.org/) | Bird recordings | **Per-item CC** (as stated on the recording page); attributed item by item; ND never transcoded |
| whitenoise.earthtrip.online | Ambient birdsong / L5 distractor audio | **Owned by this project**, no third-party obligations |

### Open datasets and taxonomy backbone

| Source | Usage | Licence and obligations |
|---|---|---|
| [AviList v2025b](https://www.avilist.org/) (AviList Core Team) | Global bird taxonomy backbone (11,131 species) | **CC BY 4.0**; `species-index.json` carries `citation` and `sources[]` |
| [GBIF](https://www.gbif.org/) (occurrence + backbone) | Distribution / provincial commonness / seasonality / birding spots / taxon keys | **Per-record CC0 / CC BY / CC BY-NC**; every download records its dataset DOI and attribution |
| [eBird](https://ebird.org/) (Cornell Lab, API v2) | Birding spots / regions (nearest-name) | **Non-commercial; attribution required; no redistribution of raw data**; only derived results are published (≥6 species + 0.25° grid dedup) |
| [ISO 3166-2](https://github.com/alexander-schranz/iso-3166-2) | First-level administrative divisions | **MIT** |
| *Life-history and ecological traits of Chinese birds* (2021) | Residence type (migrant / resident) | Open data paper, **cited by academic convention** (no explicit CC on the dataset page); non-commercial use only |
| [Wikidata](https://www.wikidata.org/) | Chinese species names, **Chinese family names** | **CC0 1.0**; resolved via the Action API using exact specieswiki titles |
| [IUCN Red List](https://www.iucnredlist.org/) (API v4) | Structured habitats and systems | **Non-commercial; citation required**; no commercial use, no redistribution of raw datasets |
| [AVONET](https://doi.org/10.1111/ele.13898) (Tobias et al. 2022) | Morphology / ecological variables | **CC BY 4.0** |
| [EltonTraits 1.0](https://doi.org/10.1890/13-1917.1) (Wilman et al. 2014) | Diet / foraging strata / nocturnality | Paper companion data, **citation required** |
| [Dunning et al. 2025](https://doi.org/10.5061/dryad.jq2bvq8jg) | Plumage (12 hue classes × male/female) | **CC0-1.0** (citation kept for traceability) |
| Wikipedia (zh / en) | Narrative identification notes (registered, not implemented) | **CC BY-SA 4.0** (copyleft; attribution + licence link required when implemented) |

### Identification models (local browser inference)

| Model | Usage | Licence |
|---|---|---|
| [BirdNET v2.4](https://github.com/kahst/BirdNET-Analyzer) (Cornell Lab) | Sound ID (6,522 classes, WASM local inference) | **CC BY-NC-SA 4.0** (non-commercial; attribution + share-alike) |
| [OSEA](https://huggingface.co/sunjiao/osea) (Sun Jiao) | Photo ID (11,000 classes, WASM local inference) | Weights are **attribution-only** (credit is enough); its code is **GPL-3.0** and this project **does not use** it; the DIB-10K training images need separate assessment before commercial use |

- **Per-item media licences are authoritative** (e.g. if a recording is CC BY-NC, that item is under that licence); attribution is shown for every quiz item and every species page.
- The licence policy can be switched in Settings: relaxed (includes CC BY-NC, non-commercial) / strict (CC0 / BY / BY-SA only).
- Licence filtering and attribution live in `src/core/licenseGuard.ts` and `scripts/lib/license.mjs`; region / season / hotspot attribution is checked by `scripts/check-region.mjs`.
- Identification runs entirely on-device (Web Worker + onnxruntime-web); recordings and photos are never uploaded.

## Development

```bash
npm install
npm run dev          # dev server
npm run build        # type-check + build
npm run test:unit    # unit tests
npm run lint          # lint
npm run format       # format
```

> If npm is slow, use a mirror: `npm config set registry https://registry.npmmirror.com`

## Feature progress

- ✅ P0 scaffolding: Vite + Vue 3 + TS + Pinia + router + tests + lint
- ✅ P1 static question bank: `scripts/build-bank.mjs` fetches iNat/XC → licence filter → `manifest.json` (1,299 species / 5 photos + 5 recordings)
- ✅ P2 core gameplay: photo quiz / audio quiz (options, feedback, per-item attribution, result review, multiple assets per species)
- ✅ P3 experience: preloading, lazy loading, Service Worker persistence
- ✅ P4 difficulty ladder L1–L5 (option count, time limit, commonness, pool, L5 random distractor audio)
- ✅ P5 audio autoplay (configurable in Settings)
- ✅ User data (local IndexedDB): multiple profiles, round history, wrong-answer book, badges/titles, editable result posters, export/import
- ✅ Result sharing: generate a public link for a round (poster QR → that page); anyone can view each item's media/answer/mistakes/attribution; revocable with an admin token
- ✅ P6 edge backend: Cloudflare Workers + D1 + R2 (`/api/manifest`, `/api/questions`, `/api/media/:id`, reports/public review `/reports` + `/admin`)
- ✅ P7 adaptive difficulty (rolling accuracy over the last 5 rounds)
- ✅ Content: species profiles (group / distribution / residence), explainer `/faq`, region browsing `/region` (continents → countries/provinces → species)
- ✅ Regional data: seasonality `seasonality.json`; **province layer (sharded, P1-6)** `region-provinces/index.json` + 29 country shards (incl. China's 34 divisions, with Hong Kong/Macao/Taiwan labelled) + per-species-prefix buckets `region-species/*.json`; **country-level record counts** `region-records/` (**249 country/territory codes** — GBIF `countrycode` covers the full ISO 3166-1 set incl. dependencies and special areas, not the number of sovereign states; includes records without a province); birding spots `hotspots-ebird/` (eBird-derived spots + GBIF grid)
- ✅ i18n (zh-CN / en, 875 keys, CI gate) · accessibility (H3) · E2E (Playwright 13 specs, fully offline)
- ✅ Global expansion (data layer): AviList v2025b backbone `species-index.json` (11,131 species) + `taxonKey`/`playable` in the manifest; 5,808 Chinese names (curated first + Wikidata CC0); backbone mapping 10,892/11,131; global avifauna layer `/region` (249 countries) + lightweight species pages
- ✅ Global media collection: **11,026 playable species** (photos 10,888 / audio 10,356) uploaded to R2, attributed item by item, ND never transcoded
- ✅ Full catalogue `/catalog`: **11,026 species / 46 orders / 252 families**, browsable as order → family → species (224/252 families have Chinese names); taxonomy / pinyin / commonness sorting (keys precomputed at build time) + A–Z jump + pinyin search
- ✅ Anonymous metrics and sharing: **anonymous event counts** (no cookies, device IDs or IPs; can be disabled in Settings); share pages with **OG previews**, **view counts** and **offline retry**
- 🚧 In progress: gameplay integration (P3) — global pool in quizzes, manifest layer loading, commonness tiers, media quality feedback loop (see `docs/029`)

## Privacy

- **Scores and profiles stay on your device**: round history, wrong-answer book, badges/titles, nickname and share-admin token live in browser IndexedDB / localStorage and are never uploaded.
- **Anonymous metrics (opt-out)**: the site only counts **events** — date × event type (e.g. "round completed", "region page viewed") × a few enumerated properties (quiz type `image/audio`, difficulty `L1–L5`, page category).
  No cookies, no device fingerprints, no persistent identifiers, no IP/UA stored; the counters contain no key that can be linked to a person. Turning off "anonymous metrics" in Settings stops all reporting.
- **User-initiated sharing**: a round link is created only on user action and contains just that round's questions and media links; it can be revoked at any time (others get 404). Share pages are `noindex`.

## Deployment (Cloudflare Pages)

This is a pure static SPA; **Cloudflare Pages** is enough.

### Option A (recommended, simplest): commit the question bank

1. Run `npm run bank` once locally (generates `public/data/manifest.json`) and `git add` it.
2. Configure Pages:

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | 22+ (`NODE_VERSION=22`) |

> `public/data/manifest.json` is only metadata + remote URLs + attribution (no media), so it is small.
> To refresh the bank, re-run `npm run bank` locally and commit.

### Option B: generate the bank during the build

| Setting | Value |
|---|---|
| Build command | `npm run bank && npm run build` |
| Output directory | `dist` |
| Environment | `XC_API_KEY` = your Xeno-canto key (encrypted) |

- Or use `npm run build:pages` (= `bank --concurrency 6 --max-minutes 15 && build`).
- ⚠️ Pages builds time out around 20 minutes; 100 species + slow iNat may exceed it, hence `--max-minutes 15`.

### Notes

- SPA deep links (`/wrong`, `/profile`) are handled by `public/_redirects`.
- **Do not run only `npm run build` without committing the bank**: `/data/manifest.json` would not exist, the SPA fallback would return HTML, and the frontend would fail with `Unexpected token '<'`.
- After P6 the bank can live in R2/Worker and be read at build time, removing this step.

## Follow / Contact

- GitHub: [zuoguyoupan2023](https://github.com/zuoguyoupan2023) · repository [uniaoer](https://github.com/zuoguyoupan2023/uniaoer)
- Xiaohongshu (RedNote): **左顾右盼** — ID `zuoguyoupan2026` (search the ID in the app)

---

> **特别致谢：感恩蓝色大肥鱼DeepSeek的辛勤工作！**
>
> **Special thanks to Blue Big Fish DeepSeek for her hard work!**
