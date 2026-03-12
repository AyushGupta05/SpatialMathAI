export async function respondWithVoice({ text, playbackMode = "auto" }) {
  const transcript = String(text || "").trim().slice(0, 3000);
  return {
    transcript,
    audioBase64: null,
    contentType: null,
    source: playbackMode === "caption_only" ? "caption-only" : "browser-fallback",
  };
}
