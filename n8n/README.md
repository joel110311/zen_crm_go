# WhatsApp Embedded Signup backup

Import `workflows/whatsapp-login-code-crm.json` in n8n and configure these credentials before activating it:

1. `Webhook Embedded Signup`: select a Header Auth credential whose header matches the CRM configuration (`X-Zen-CRM-Key` by default).
2. `Crear credencial cifrada`: select an `n8n account` credential created from the n8n API settings.
   - Base URL: `https://n8nla.synapselogik.com/api/v1`
   - API Key: generate it in n8n under Settings > API.

The workflow verifies that the received phone belongs to the supplied WABA before storing the Meta access token as an encrypted n8n credential. No secret is included in the exported workflow.
