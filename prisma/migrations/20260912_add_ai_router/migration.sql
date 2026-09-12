ALTER TABLE "SystemSettings"
ADD COLUMN "aiRouterEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "aiRouterTimeoutMs" INTEGER NOT NULL DEFAULT 4000,
ADD COLUMN "aiRouterFallbackEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "customLlmEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "customLlmName" TEXT DEFAULT 'OpenAI-compatible',
ADD COLUMN "customLlmBaseUrl" TEXT,
ADD COLUMN "customLlmModel" TEXT,
ADD COLUMN "customLlmApiKey" TEXT;
