export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { embedText } from '@/lib/embedder';

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request) {
  // Auth — same secret used by the churn-detection endpoint
  const secret = request.headers.get('x-api-secret');
  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Parse body
  let query;
  try {
    ({ query } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!query || typeof query !== 'string' || !query.trim()) {
    return NextResponse.json({ error: '"query" string is required' }, { status: 400 });
  }

  const supabase = createAdminClient();

  try {
    // Embed the caller's question using the same model that indexed the docs,
    // so the vector spaces are comparable.
    const embedding = await embedText(query.trim());

    // Cosine similarity search via the pgvector function defined in schema.sql.
    // match_count: 3 keeps the context tight — a voice agent can only act on
    // so much information mid-call.
    const { data, error } = await supabase.rpc('match_kb_documents', {
      query_embedding: embedding,
      match_count:     3,
    });

    if (error) throw error;

    const results = (data ?? []).map(row => ({
      title:      row.title,
      category:   row.category,
      content:    row.content,
      similarity: Math.round(row.similarity * 1000) / 1000,  // 3 d.p. is enough
    }));

    return NextResponse.json({ results });

  } catch (err) {
    console.error('[search-kb]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
