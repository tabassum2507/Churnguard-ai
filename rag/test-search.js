#!/usr/bin/env node
'use strict';

// ─── Load .env.local ──────────────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');

const envFile = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq  = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = val;
  }
}

const { createClient } = require('@supabase/supabase-js');

// ─── Test queries — designed to surface different categories ──────────────────
const TEST_QUERIES = [
  { label: 'Troubleshooting',   q: 'my dashboard is loading really slowly'              },
  { label: 'Plan comparison',   q: 'what do I get if I upgrade to pro'                  },
  { label: 'Onboarding',        q: 'how do I add my teammates to the workspace'         },
  { label: 'Feature tip',       q: 'can I get my reports sent automatically each week'  },
  { label: 'Config fix',        q: 'the times on my events look wrong, wrong timezone'  },
];

// ─── Similarity bar (visual) ──────────────────────────────────────────────────
function simBar(score, width = 24) {
  const filled = Math.round(score * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// ─── Snippet: first N characters of content, trimmed to a word boundary ───────
function snippet(text, maxLen = 120) {
  if (text.length <= maxLen) return text;
  const cut = text.lastIndexOf(' ', maxLen);
  return text.slice(0, cut > 0 ? cut : maxLen) + '…';
}

const rule = (c = '─', n = 72) => c.repeat(n);

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('✗  Missing Supabase env vars. Fill in .env.local first.');
    process.exit(1);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Check that kb_documents has rows before we bother loading the model
  const { count, error: countErr } = await supabase
    .from('kb_documents')
    .select('*', { count: 'exact', head: true });
  if (countErr) throw countErr;

  if (!count || count === 0) {
    console.error('✗  kb_documents is empty. Run "npm run embed" first.');
    process.exit(1);
  }

  console.log(`\n✓  kb_documents has ${count} documents\n`);
  console.log('🔍 Loading embedding model...');

  const { pipeline, env } = await import('@xenova/transformers');
  env.cacheDir = path.resolve(__dirname, '../.cache/transformers');

  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log('✓  Model ready\n');

  console.log(rule('═'));
  console.log('  ChurnGuard AI — Knowledge Base Search Test');
  console.log(rule('═'));

  for (const { label, q } of TEST_QUERIES) {
    console.log(`\n  [${label}]`);
    console.log(`  Query: "${q}"`);
    console.log('  ' + rule('·', 68));

    // Embed the query
    const output    = await embedder(q, { pooling: 'mean', normalize: true });
    const embedding = Array.from(output.data);

    // Similarity search via pgvector
    const { data, error } = await supabase.rpc('match_kb_documents', {
      query_embedding: embedding,
      match_count:     3,
    });
    if (error) throw error;

    if (!data || data.length === 0) {
      console.log('  (no results)');
      continue;
    }

    data.forEach((row, i) => {
      const score = Math.round(row.similarity * 1000) / 1000;
      console.log(`\n  ${i + 1}. ${row.title}`);
      console.log(`     category  : ${row.category}`);
      console.log(`     similarity: ${score.toFixed(3)}  ${simBar(score)}`);
      console.log(`     preview   : ${snippet(row.content)}`);
    });
  }

  console.log('\n' + rule('═') + '\n');
}

main().catch(err => {
  console.error('\n✗ Search test failed:', err.message);
  process.exit(1);
});
