ALTER TABLE "SystemSettings"
    ADD COLUMN IF NOT EXISTS "messengerAppId" TEXT,
    ADD COLUMN IF NOT EXISTS "messengerAppSecret" TEXT,
    ADD COLUMN IF NOT EXISTS "messengerGraphApiVersion" TEXT DEFAULT 'v23.0',
    ADD COLUMN IF NOT EXISTS "messengerWebhookVerifyToken" TEXT,
    ADD COLUMN IF NOT EXISTS "messengerWebhookBaseUrl" TEXT,
    ADD COLUMN IF NOT EXISTS "messengerPageId" TEXT,
    ADD COLUMN IF NOT EXISTS "messengerPageName" TEXT,
    ADD COLUMN IF NOT EXISTS "messengerPageAccessToken" TEXT,
    ADD COLUMN IF NOT EXISTS "messengerWebhookSubscribed" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "messengerConnectedAt" TIMESTAMP(3);
