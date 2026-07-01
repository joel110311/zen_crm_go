ALTER TABLE "SystemSettings"
    ADD COLUMN IF NOT EXISTS "whatsappWabaId" TEXT,
    ADD COLUMN IF NOT EXISTS "whatsappPhoneNumberId" TEXT,
    ADD COLUMN IF NOT EXISTS "whatsappDisplayPhoneNumber" TEXT,
    ADD COLUMN IF NOT EXISTS "whatsappAccessToken" TEXT,
    ADD COLUMN IF NOT EXISTS "whatsappBusinessId" TEXT,
    ADD COLUMN IF NOT EXISTS "whatsappMetaAppId" TEXT,
    ADD COLUMN IF NOT EXISTS "whatsappMetaAppSecret" TEXT,
    ADD COLUMN IF NOT EXISTS "whatsappEmbeddedSignupConfigId" TEXT,
    ADD COLUMN IF NOT EXISTS "whatsappTechProviderSolutionId" TEXT,
    ADD COLUMN IF NOT EXISTS "whatsappGraphApiVersion" TEXT DEFAULT 'v23.0',
    ADD COLUMN IF NOT EXISTS "whatsappRegistrationPin" TEXT,
    ADD COLUMN IF NOT EXISTS "whatsappWebhookVerifyToken" TEXT,
    ADD COLUMN IF NOT EXISTS "whatsappWebhookBaseUrl" TEXT,
    ADD COLUMN IF NOT EXISTS "whatsappConnectedAt" TIMESTAMP(3);

ALTER TABLE "SystemSettings"
    DROP COLUMN IF EXISTS "ycloudApiKey",
    DROP COLUMN IF EXISTS "ycloudPhoneId";

UPDATE "SystemSettings"
SET "whatsappGraphApiVersion" = 'v23.0'
WHERE "whatsappGraphApiVersion" IS NULL;

ALTER TABLE "Message"
    DROP CONSTRAINT IF EXISTS "Message_source_type_check";

UPDATE "Message"
SET "source_type" = 'meta'
WHERE "source_type" = 'ycloud';

ALTER TABLE "Message"
    ADD CONSTRAINT "Message_source_type_check"
    CHECK ("source_type" IN ('wuzapi', 'meta'));

ALTER TABLE "Conversation"
    DROP CONSTRAINT IF EXISTS "Conversation_source_type_check";

UPDATE "Conversation"
SET "source_type" = 'meta'
WHERE "source_type" = 'ycloud';

ALTER TABLE "Conversation"
    ADD CONSTRAINT "Conversation_source_type_check"
    CHECK ("source_type" IN ('wuzapi', 'meta'));

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'BulkCampaign' AND column_name = 'ycloudTemplateName'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'BulkCampaign' AND column_name = 'metaTemplateName'
    ) THEN
        ALTER TABLE "BulkCampaign" RENAME COLUMN "ycloudTemplateName" TO "metaTemplateName";
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'BulkCampaign' AND column_name = 'ycloudTemplateLanguage'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'BulkCampaign' AND column_name = 'metaTemplateLanguage'
    ) THEN
        ALTER TABLE "BulkCampaign" RENAME COLUMN "ycloudTemplateLanguage" TO "metaTemplateLanguage";
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'BulkCampaign' AND column_name = 'ycloudTemplateComponents'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'BulkCampaign' AND column_name = 'metaTemplateComponents'
    ) THEN
        ALTER TABLE "BulkCampaign" RENAME COLUMN "ycloudTemplateComponents" TO "metaTemplateComponents";
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'BulkCampaign' AND column_name = 'ycloudTemplateVariableValues'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'BulkCampaign' AND column_name = 'metaTemplateVariableValues'
    ) THEN
        ALTER TABLE "BulkCampaign" RENAME COLUMN "ycloudTemplateVariableValues" TO "metaTemplateVariableValues";
    END IF;
END $$;

ALTER TABLE "BulkCampaign"
    ADD COLUMN IF NOT EXISTS "metaTemplateName" TEXT,
    ADD COLUMN IF NOT EXISTS "metaTemplateLanguage" TEXT,
    ADD COLUMN IF NOT EXISTS "metaTemplateComponents" JSONB,
    ADD COLUMN IF NOT EXISTS "metaTemplateVariableValues" JSONB;
