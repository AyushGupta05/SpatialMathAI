# Spatial Math AI

Spatial Math AI is an AI-powered spatial reasoning tutor that turns maths and physics problems into interactive 3D scenes students can explore. Learners can enter a question, upload a worksheet image, or paste a screenshot, and the system generates a visual scene that helps them understand vectors, planes, geometry, and other spatial concepts more intuitively. It combines adaptive tutoring, voice interaction, and gesture-based manipulation so students can see the structure of a problem instead of trying to imagine it from a flat diagram.

## Local setup

### Requirements

- Node.js 20+
- npm
- Webcam for hand tracking
- Microphone for push-to-talk voice mode

### Install

```bash
npm install
pip install -r requirements.txt
```

### Environment

Create `.env.local` in the project root:

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_SESSION_TOKEN=your_session_token
```

The app still runs without Bedrock credentials but alot of the core functionality will become unavailable

## Run

```bash
npm run dev
```

Then open `http://localhost:3000`.

## Architecture

### High-level system design

```text
+---------------------------------------------------------------+
| Frontend                                                      |
| Vanilla JS + Three.js                                         |
|                                                               |
| - Question input (text, image, screenshot)                    |
| - 3D scene rendering                                          |
| - Tutor panel                                                 |
| - Voice UI                                                    |
| - Hand tracking                                               |
| - KaTeX rendering                                             |
+---------------------------------------------------------------+
                           |
                           | HTTP / SSE
                           v
+---------------------------------------------------------------+
| Backend                                                       |
| Node.js + Hono API                                            |
|                                                               |
| - Request validation                                          |
| - Amazon Bedrock integration                                  |
| - Model orchestration and fallback                            |
| - SceneSpec generation                                        |
| - Tutor streaming                                             |
| - Voice pipeline coordination                                 |
+---------------------------------------------------------------+
                           |
                           v
+---------------------------------------------------------------+
| Amazon Bedrock                                                |
|                                                               |
| - Amazon Nova Multimodal Embeddings                           |
| - Amazon Nova Lite                                            |
| - Amazon Nova Sonic                                           |
+---------------------------------------------------------------+
```
