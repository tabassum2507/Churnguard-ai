-- Migration 002 — add 'initiated' to call_status_type enum
-- Run this in the Supabase SQL Editor before deploying trigger-call route.
--
-- WHY: rescue_calls rows are now inserted at call initiation (not just at
-- call end), so we need a status that means "Vapi has queued this call but
-- it hasn't connected yet". The call-ended webhook updates it to the real
-- final status (completed / no_answer / voicemail / failed).
--
-- Postgres enums are append-only — you can add values but not remove or
-- reorder them without recreating the type. 'initiated' is safe to add.

ALTER TYPE call_status_type ADD VALUE IF NOT EXISTS 'initiated';
