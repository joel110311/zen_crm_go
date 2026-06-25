-- Add receipt fields for order payment evidence. This migration is idempotent
-- because some production databases applied the original orders migration before
-- these columns were added to the schema.
ALTER TABLE "OrderPayment"
    ADD COLUMN IF NOT EXISTS "receiptUrl" TEXT,
    ADD COLUMN IF NOT EXISTS "receiptFileName" TEXT;
