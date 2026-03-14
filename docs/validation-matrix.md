# Nova Prism Validation Matrix

Validation run captured on March 14, 2026.

## Automated regressions

- `test/tutor-conversation.test.js`
  - first lower-chat math prompt starts a lesson instead of staying in fragile freeform chat
- `test/tutor-route.test.js`
  - freeform fallback returns a safe reply even when the generator throws
- `test/line-schema.test.js`
  - line span and thickness stay decoupled so long lines do not inflate into cylinder-like drafts
- `test/voice-route.test.js`
  - voice model selection falls through cleanly instead of surfacing invalid-model errors
- `test/voice-session.test.js`
  - realtime Sonic session lifecycle covers start, streaming audio, transcripts, and stop handling
- `test/plan-schema.test.js`
  - representation mode normalizes to `3d`, `split_2d`, or `2d` for supported lesson families
- `test/tutor-metadata.test.js`
  - tutor scene directives can request the 2D companion when it clarifies the lesson
- `test/electric-field-plan.test.js`
  - focused EM lessons generate charge-aware scene objects and flux surfaces
- `test/freeform-physics.test.js`
  - freeform tutor requests can load the electric-field playground without a prior lesson
- `test/supported-topic-matrix.test.js`
  - builder, analytic, and focused physics prompts all map to the intended supported lesson families

## Browser smoke checks

Run against `http://localhost:3002/index.html` with Playwright CLI on March 14, 2026.

- Lower composer cold start
  - prompt: `What happens to the volume when you double the radius of a cylinder?`
  - result: first message bootstrapped a lesson, `/api/plan` and `/api/build/evaluate` returned `200`, and the browser console stayed clean
- 2D companion switch
  - prompt: `Show me the surface area of a cube as a net.`
  - result: lesson switched into `2d` representation mode and the `2D Lesson View` companion panel rendered
- Analytic geometry
  - prompt: `Show me a line-plane intersection example in 3D.`
  - result: lesson stayed in `3d` mode and loaded the analytic line/plane scene
- Electric-field playground
  - prompt: `Show me an electric dipole field with moving particles.`
  - result: focused EM lesson loaded with charge labels in-scene and no console errors

## Remaining manual checks

- Gesture-driven line placement is only partially automatable in headless Playwright because the placement flow depends on live scene manipulation. The core regression is still protected by `test/line-schema.test.js`.
- Realtime microphone capture is covered at the API/session level, but full press-and-hold browser audio capture still needs a headed manual pass on a machine with microphone access.
