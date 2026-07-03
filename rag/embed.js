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

const KB_DIR = path.resolve(__dirname, 'knowledge-base');

// ─── Frontmatter parser ───────────────────────────────────────────────────────
// Extracts title, category, and body from --- YAML blocks.
// Kept intentionally minimal — no external YAML dependency needed.
function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { title: 'Untitled', category: 'general', body: raw.trim() };

  const yaml = match[1];
  const body = match[2].trim();

  const titleMatch = yaml.match(/^title:\s*["']?(.+?)["']?\s*$/m);
  const catMatch   = yaml.match(/^category:\s*(\S+)/m);

  return {
    title:    titleMatch ? titleMatch[1].trim() : path.basename(raw, '.md'),
    category: catMatch   ? catMatch[1].trim()   : 'general',
    body,
  };
}

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

  // @xenova/transformers is ESM — dynamic import is required from a CJS file
  console.log('🔍 Loading Xenova/all-MiniLM-L6-v2...');
  console.log('   First run downloads ~23 MB to ~/.cache/huggingface/hub/ — cached after that.\n');

  const { pipeline, env } = await import('@xenova/transformers');

  // Point cache at a local dir so CI/Docker environments don't need home dirs
  env.cacheDir = path.resolve(__dirname, '../.cache/transformers');

  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log('✓  Model ready\n');

  // ── Read documents ──────────────────────────────────────────────────────────
  const files = fs
    .readdirSync(KB_DIR)
    .filter(f => f.endsWith('.md') && f !== '.gitkeep')
    .sort();

  if (files.length === 0) {
    console.error('✗  No markdown files found in rag/knowledge-base/');
    process.exit(1);
  }

  console.log(`📄 ${files.length} documents found in rag/knowledge-base/\n`);

  // ── Clear existing rows so re-running produces a clean state ────────────────
  const { error: clearErr } = await supabase
    .from('kb_documents')
    .delete()
    .not('id', 'is', null);
  if (clearErr) throw new Error(`[clear] ${clearErr.message}`);
  console.log('🗑  Cleared existing kb_documents rows\n');

  // ── Embed each document ─────────────────────────────────────────────────────
  const rows = [];

  for (const file of files) {
    const raw   = fs.readFileSync(path.join(KB_DIR, file), 'utf8');
    const { title, category, body } = parseFrontmatter(raw);

    process.stdout.write(`  ⚙  ${file.padEnd(48)}`);

    const output    = await embedder(body, { pooling: 'mean', normalize: true });
    const embedding = Array.from(output.data);   // Float32Array → plain array

    rows.push({ title, category, content: body, embedding });
    process.stdout.write(`✓  ${embedding.length}d\n`);
  }

  // ── Insert all rows in one call ─────────────────────────────────────────────
  console.log(`\n📥 Inserting ${rows.length} documents into kb_documents...`);
  const { error: insertErr } = await supabase.from('kb_documents').insert(rows);
  if (insertErr) throw new Error(`[insert] ${insertErr.message}`);

  console.log(`\n✅ Embedded and stored ${rows.length} documents.\n`);
  console.log('   Run "npm run search:test" to verify similarity search works.\n');
}

main().catch(err => {
  console.error('\n✗ Embed failed:', err.message);
  process.exit(1);
});
