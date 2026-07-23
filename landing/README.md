# Clinic EMR — Landing Teaser

A standalone, cinematic single-page teaser for the Clinic EMR product. It is a
**separate project** from the main product (`../web` frontend and `../backend`
API) — it shares no code and has its own dependencies.

The page is positioned around **AI-first clinical intelligence**: an AI scribe
that expands shorthand into structured notes, a patient-context engine, and
AI assistance across the clinic workflow — presented as a scroll-driven,
GTA-VI-style experience with backgrounds that crossfade as you scroll.

## Stack

- **Vite** + **React 19** + **TypeScript**
- **GSAP** + **ScrollTrigger** — scroll-driven animation, pinned reveals, parallax
- **Lenis** — buttery smooth scroll, synced to the GSAP ticker
- **react-router-dom** — real `/early-access` route + cinematic wipe transition
- No UI framework; all visuals are generated with CSS (gradients, glow orbs, grain)

## Run it

```bash
cd landing
npm install      # first time only
npm run dev      # http://localhost:5173
```

Other scripts:

```bash
npm run build    # type-check + production build into dist/
npm run preview  # serve the built dist/ locally
npm run lint     # oxlint
```

## Project structure

```text
landing/
├── index.html              # entry + fonts + meta
├── src/
│   ├── main.tsx            # router setup (Landing + EarlyAccess routes)
│   ├── index.css           # global styles + design tokens (:root)
│   ├── App.css             # all component/page styles
│   ├── scenes.ts           # ALL landing copy + per-beat background gradients
│   ├── access.ts           # ACCESS_ENDPOINT config for the form
│   ├── transition.tsx      # cinematic route wipe (TransitionProvider / useTransition)
│   ├── pages/
│   │   ├── Landing.tsx      # the scrolling teaser (Lenis + ScrollTrigger setup)
│   │   └── EarlyAccess.tsx  # /early-access split-screen page + form
│   └── components/
│       ├── Backdrop.tsx     # fixed crossfading gradient layers + glow orbs
│       ├── Nav.tsx          # top nav
│       ├── Hero.tsx         # opening hero
│       ├── Scene.tsx        # a single scroll beat (text + visual)
│       ├── SceneVisual.tsx  # generated abstract visuals per beat
│       ├── Finale.tsx       # closing CTA section
│       ├── Footer.tsx       # subtle DPDP compliance footer
│       └── ScrollProgress.tsx
```

## How it works

- **Backdrop crossfade:** `Backdrop` renders one fixed full-screen gradient
  layer per scene. `Landing.tsx` creates a `ScrollTrigger` per section that
  fades the matching layer in as it enters the viewport — that's the "background
  changes as you scroll" effect.
- **Smooth scroll:** a single `Lenis` instance is driven by the GSAP ticker, so
  smooth scrolling and scroll-triggered animation stay perfectly in sync.
- **Route wipe:** clicking a "Request early access" button calls
  `useTransition().go("/early-access")`, which slides a panel over the screen,
  swaps the route behind it, then reveals the new page.
- **Reduced motion:** if the user prefers reduced motion, Lenis and scrubbed
  animations are disabled automatically.

## Editing common things

- **Copy & section backgrounds:** `src/scenes.ts`
- **Brand colors / fonts:** `:root` in `src/index.css`
- **Hero / finale / footer text:** the matching component in `src/components/`
- **Early-access perks & page copy:** `src/pages/EarlyAccess.tsx`
- **Product name:** search for `Clinic<span className="nav__brand-thin">EMR`

## Early-access form

The form (`name`, `email`, `clinic`, `role`) uses Web3Forms when
`WEB3FORMS_ACCESS_KEY` in `src/access.ts` contains a real key. With the
placeholder value, submissions stay in demo mode and are simulated locally.

The Firebase Hosting site id in `firebase.json` is separate from the Cloud Run
web service, even though both currently use the `clinic-os-ai` name. Verify the
target and custom domain before deploying this landing app.

## Deployment note

This is a multi-route SPA. Whatever hosts the built `dist/` must have an
**SPA fallback** (rewrite all unknown paths to `index.html`) so `/early-access`
works on a direct visit or refresh. The Vite dev server already does this.

## Compliance

The footer states the page is "designed to support India's DPDP Act, 2023" and
notes patient data is encrypted in transit/at rest and not used to train
third-party AI models. The wording is intentionally aspirational/accurate — it
does **not** claim certifications. Update `src/components/Footer.tsx` if your
compliance posture changes.
