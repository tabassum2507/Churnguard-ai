-- Migration 001 — add customer_touchpoints table
-- Run this in the Supabase SQL Editor after the initial schema.sql

CREATE TABLE customer_touchpoints (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  channel     TEXT NOT NULL,          -- 'voice' | 'email' | 'slack' | 'sms'
  content     TEXT NOT NULL,          -- human-readable summary of what happened
  status      TEXT NOT NULL DEFAULT 'sent',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_touchpoints_customer_id ON customer_touchpoints (customer_id);
