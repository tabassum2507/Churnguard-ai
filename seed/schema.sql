-- ChurnGuard AI — FlowMetric Supabase Schema
-- Voice AI churn rescue system (PostgreSQL / Supabase)

-- ─────────────────────────────────────────────
-- Extensions
-- ─────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- ─────────────────────────────────────────────
-- Enum types
-- ─────────────────────────────────────────────

CREATE TYPE plan_type AS ENUM ('free', 'starter', 'pro', 'enterprise');
CREATE TYPE risk_level_type AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE event_type AS ENUM ('login', 'feature_use', 'api_call', 'export', 'invite_member');
CREATE TYPE ticket_status AS ENUM ('open', 'resolved', 'escalated');
CREATE TYPE priority_type AS ENUM ('low', 'medium', 'high');
CREATE TYPE call_status_type AS ENUM ('completed', 'no_answer', 'voicemail', 'failed');
CREATE TYPE call_outcome_type AS ENUM ('saved', 'escalated', 'churned', 'pending');
CREATE TYPE sentiment_type AS ENUM ('positive', 'neutral', 'negative');

-- ─────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────

CREATE TABLE customers (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             TEXT NOT NULL,
  email            TEXT NOT NULL UNIQUE,
  phone            TEXT,
  company          TEXT NOT NULL,
  plan             plan_type NOT NULL DEFAULT 'free',
  signup_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  mrr              NUMERIC(10, 2) NOT NULL DEFAULT 0,
  health_score     INT NOT NULL DEFAULT 80 CHECK (health_score BETWEEN 0 AND 100),
  risk_level       risk_level_type NOT NULL DEFAULT 'low',
  last_contacted_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE usage_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  event_type  event_type NOT NULL,
  feature     TEXT,
  event_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  count       INT NOT NULL DEFAULT 1 CHECK (count > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE support_tickets (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  subject     TEXT NOT NULL,
  status      ticket_status NOT NULL DEFAULT 'open',
  priority    priority_type NOT NULL DEFAULT 'low',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE rescue_calls (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id      UUID NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  vapi_call_id     TEXT NOT NULL UNIQUE,
  call_status      call_status_type NOT NULL,
  call_duration    INT CHECK (call_duration >= 0),   -- seconds
  friction_points  TEXT[],
  solution_offered TEXT,
  outcome          call_outcome_type NOT NULL DEFAULT 'pending',
  sentiment        sentiment_type,
  transcript       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE kb_documents (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title      TEXT NOT NULL,
  category   TEXT NOT NULL,
  content    TEXT NOT NULL,
  embedding  vector(384),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────

CREATE INDEX idx_usage_events_customer_id  ON usage_events (customer_id);
CREATE INDEX idx_usage_events_event_date   ON usage_events (event_date);
CREATE INDEX idx_support_tickets_customer_id ON support_tickets (customer_id);
CREATE INDEX idx_rescue_calls_customer_id  ON rescue_calls (customer_id);

-- IVFFlat index for approximate nearest-neighbour search on embeddings.
-- Build after inserting data; lists ≈ sqrt(row_count) is a reasonable starting point.
CREATE INDEX idx_kb_documents_embedding
  ON kb_documents
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ─────────────────────────────────────────────
-- Vector similarity search function
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION match_kb_documents (
  query_embedding vector(384),
  match_count     INT DEFAULT 5
)
RETURNS TABLE (
  id         UUID,
  title      TEXT,
  category   TEXT,
  content    TEXT,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    kb_documents.id,
    kb_documents.title,
    kb_documents.category,
    kb_documents.content,
    1 - (kb_documents.embedding <=> query_embedding) AS similarity
  FROM kb_documents
  WHERE kb_documents.embedding IS NOT NULL
  ORDER BY kb_documents.embedding <=> query_embedding
  LIMIT match_count;
$$;
