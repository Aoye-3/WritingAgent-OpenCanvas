# OpenCanvas UI Asset Library

OpenCanvas keeps local UI and image assets under `public/assets/ui`.

## Brand

- Full lockup: `public/assets/ui/brand/opencanvas-lockup.png`
- Icon only: `public/assets/ui/brand/opencanvas-icon.png`
- Generated concept sheet: `public/assets/ui/brand/opencanvas-logo-concepts.png`

Frontend code should reference shared asset paths from `src/shared/brandAssets.ts`.

OpenCanvas is the external product brand. FacetWrite remains the smaller technical lineage mark and internal engineering name.

## Home Visual Assets

The Home page visual refresh keeps its generated art assets under `public/assets/ui/home/`.

Runtime assets:

- Sidebar texture: `public/assets/ui/home/sidebar-gradient-texture.png`
- Home panel texture: `public/assets/ui/home/home-panel-texture-bg.png`
- Clay plant illustration: `public/assets/ui/home/home-plant-illustration.png`

Source or retained exploration assets:

- Plant key source: `public/assets/ui/home/home-plant-illustration-key.png`
- Earlier panel concepts: `public/assets/ui/home/home-card-clay-stack-bg.png`, `public/assets/ui/home/home-panel-subtle-layered-bg.png`

Implementation notes:

- `src/app/styles.css` owns Home asset placement. Keep the plant as an independent layer between the textured panel background and the AI composer so the composer can visually cover the plant.
- Keep the panel background subtle: a warm highlight in the upper-right, a low-opacity cool wash near the bottom, and a paper-like texture. Avoid a pure white panel or a high-contrast illustration background.
- The Home panel uses a fixed-height top decorative layer over a cool, full-panel base. Do not attach the warm/yellow texture to the full scroll height; long project lists must not stretch the art into an all-yellow background.
- The Home panel should connect to the viewport bottom on desktop. Avoid adding bottom outer gutters that reveal the app background under the panel.
- Home controls use Radix Themes components in `src/features/home/HomeView.tsx`. Do not replace them with local hand-rolled buttons/selects when adjusting visual polish.
- The Home layout is tuned around the persistent left sidebar. Desktop changes should preserve the main panel's full-width workbench feel and avoid returning to a narrow centered card.
- Home recents uses one page scrollbar. The left sidebar remains fixed, the recents controls may be grouped in a sticky glass panel, and project cards must stay in normal page flow rather than introducing a nested project-list scrollbar.
