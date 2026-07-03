export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { embedText } from '@/lib/embedder';

// ─── Vapi request parser ──────────────────────────────────────────────────────
//
// As of mid-2025 Vapi's server-tool payload uses:
//   message.toolCallList[].{ id, name, arguments: <object> }
//
// Older Vapi versions (and the OpenAI-compatible format) used:
//   message.toolCalls[].{ id, function: { name, arguments: "<json string>" } }
//
// We support both so the endpoint keeps working through Vapi schema revisions.
//
function parseToolCall(body) {
  const msg  = body?.message ?? {};

  // Current Vapi format
  if (msg.toolCallList?.length) {
    const tc = msg.toolCallList[0];
    return { toolCallId: tc.id, args: tc.arguments ?? {} };
  }

  // Legacy / OpenAI-compatible format
  if (msg.toolCalls?.length) {
    const tc   = msg.toolCalls[0];
    const raw  = tc.function?.arguments;
    const args = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {});
    return { toolCallId: tc.id, args };
  }

  throw new Error('No tool call found in request body');
}

// ─── Format KB results for voice delivery ─────────────────────────────────────
//
// The result string feeds directly into the voice LLM's context mid-call.
// Rules: no markdown, no numbered lists, conversational connectors, ≤ 300 words.
//
function formatForVoice(rows) {
  if (!rows?.length) {
    return "I checked our knowledge base but couldn't find a specific article on that topic. I can still try to help you directly.";
  }

  const excerpts = rows.map((row, i) => {
    // Trim to a comfortable listening length — roughly 2-3 short paragraphs
    const words   = row.content.split(/\s+/);
    const limit   = i === 0 ? 160 : 100;
    const excerpt = words.slice(0, limit).join(' ') + (words.length > limit ? '.' : '');
    return i === 0
      ? `Regarding ${row.title}: ${excerpt}`
      : `One more thing that might help — ${row.title}: ${excerpt}`;
  });

  return excerpts.join(' ');
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request) {
  let toolCallId = 'unknown';

  try {
    const body = await request.json();
    const { toolCallId: id, args } = parseToolCall(body);
    toolCallId = id;

    const query = args.query;
    if (!query || typeof query !== 'string') {
      throw new Error('Missing required argument: query');
    }

    const supabase   = createAdminClient();
    const embedding  = await embedText(query);

    // Top 2 results keep context tight; a voice agent can't act on more
    const { data, error } = await supabase.rpc('match_kb_documents', {
      query_embedding: embedding,
      match_count:     2,
    });
    if (error) throw error;

    // Only surface results that are meaningfully relevant (similarity > 0.4)
    const relevant = (data ?? []).filter(r => r.similarity > 0.4);

    return NextResponse.json({
      results: [{ toolCallId, result: formatForVoice(relevant) }],
    });

  } catch (err) {
    console.error('[vapi/search-kb]', err.message);
    return NextResponse.json({
      results: [{
        toolCallId,
        result: "I wasn't able to look that up right now. Let me do my best to help you from what I know.",
      }],
    });
  }
}
