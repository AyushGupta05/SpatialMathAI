# SpatialMath Nova

SpatialMath Nova is an interactive 3D math and building sandbox. It combines hand tracking, a browser-based 3D scene, and a small Node server to help users create, manipulate, and evaluate spatial scenes.

## What it does

- Tracks hand gestures in the browser for spatial interaction
- Renders and edits 3D objects with a live scene view
- Serves AI-assisted planning, tutoring, voice, challenge, and build APIs
- Includes test coverage for the server planning/build flows

## Setup

### Requirements

- Node.js 20+
- npm
- A webcam for hand tracking

### Install

```bash
npm install
```

### Environment

Create a `.env.local` file in the project root.

The app can run without AI features, but AWS credentials are needed for Bedrock/Nova-powered routes:

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_SESSION_TOKEN=your_session_token
```

## Run

Start the app:

```bash
npm run dev
```

Or run it without watch mode:

```bash
npm start
```

Then open [http://localhost:3000/index.html](http://localhost:3000/index.html).

## Test

```bash
npm test
```

## Optional Python tools

This repo also includes Python utilities in `tools/` for gesture-model training, stress testing, and signal tuning. Install them with:

```bash
pip install -r requirements.txt
```
