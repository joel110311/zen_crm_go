ALTER TABLE "SystemSettings"
ADD COLUMN "aiRouterOrder" JSONB,
ADD COLUMN "aiRouterCustomProviders" JSONB,
ADD COLUMN "aiRouterPrimaryEnabled" BOOLEAN NOT NULL DEFAULT true;
