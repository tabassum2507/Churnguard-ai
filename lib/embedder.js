// Runtime embedding via HuggingFace Inference API.
//
// WHY: @xenova/transformers downloads a ~90MB ONNX model on first load.
// On Vercel Hobby that cold-start blows the 10s function timeout.
// The HuggingFace Inference API (free tier) serves the exact same model
// (sentence-transformers/all-MiniLM-L6-v2) and returns the same 384-dim
// normalised vectors — so all existing Supabase embeddings stay valid.
//
// rag/embed.js still uses the local Xenova model for seeding because it
// runs on your dev machine where a one-time 90MB download is fine.

const HF_URL =
  'https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2';

export async function embedText(text) {
  const res = await fetch(HF_URL, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      inputs:  text.trim(),
      options: { wait_for_model: true },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HuggingFace embedding API ${res.status}: ${body}`);
  }

  // Feature-extraction returns [[float × 384]] for a single-string input.
  const data = await res.json();
  return Array.isArray(data[0]) ? data[0] : data;
}
