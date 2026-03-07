/**
 * SaaS Startup Script
 * Runs on every container boot:
 * 1. Ensures DB schema has latest columns (raw SQL, no prisma CLI needed)
 * 2. Auto-seeds default data if DB is empty (idempotent)
 * 3. Starts the Next.js server
 */
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const DATABASE_URL = process.env.DATABASE_URL;

async function startup() {
    if (!DATABASE_URL) {
        console.warn("[Startup] No DATABASE_URL, skipping DB setup.");
        return;
    }

    const pool = new Pool({ connectionString: DATABASE_URL });

    try {
        // ── 1. Schema migrations via raw SQL (no prisma CLI needed) ──
        console.log("[Startup] Checking schema...");

        // Add botActive column to Conversation if missing
        await pool.query(`
            ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "botActive" BOOLEAN DEFAULT true
        `).catch(() => { });

        // Add senderType column to Message if missing
        await pool.query(`
            ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "senderType" TEXT
        `).catch(() => { });

        // Add reaction column to Message if missing
        await pool.query(`
            ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "reaction" TEXT
        `).catch(() => { });

        // Add performance indexes
        console.log("[Startup] Creating database indexes...");
        await pool.query(`CREATE INDEX IF NOT EXISTS "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt" DESC)`).catch(() => { });
        await pool.query(`CREATE INDEX IF NOT EXISTS "Conversation_updatedAt_idx" ON "Conversation"("updatedAt" DESC)`).catch(() => { });
        await pool.query(`CREATE INDEX IF NOT EXISTS "Conversation_contactId_idx" ON "Conversation"("contactId")`).catch(() => { });
        await pool.query(`CREATE INDEX IF NOT EXISTS "Deal_stageId_idx" ON "Deal"("stageId")`).catch(() => { });
        await pool.query(`CREATE INDEX IF NOT EXISTS "Deal_contactId_idx" ON "Deal"("contactId")`).catch(() => { });
        await pool.query(`CREATE INDEX IF NOT EXISTS "Appointment_startTime_idx" ON "Appointment"("startTime")`).catch(() => { });
        await pool.query(`CREATE INDEX IF NOT EXISTS "Appointment_contactId_idx" ON "Appointment"("contactId")`).catch(() => { });

        console.log("[Startup] ✓ Schema up to date");

        // ── 2. Auto-seed if empty ──
        const { rows: stageRows } = await pool.query('SELECT COUNT(*) as count FROM "PipelineStage"');
        const stageCount = parseInt(stageRows[0].count, 10);

        if (stageCount > 0) {
            console.log("[Startup] DB already seeded (" + stageCount + " pipeline stages). Skipping seed.");
        } else {
            console.log("[Startup] Empty DB detected. Auto-seeding...");

            // System Settings
            await pool.query(`
                INSERT INTO "SystemSettings" (id, "ycloudApiKey", "ycloudPhoneId", "isBotEnabled", "updatedAt")
                VALUES ('default', '', '', false, NOW())
                ON CONFLICT (id) DO NOTHING
            `);
            console.log("[Startup] ✓ System settings");

            // Admin User
            const adminPassword = await bcrypt.hash("admin123", 12);
            const adminId = crypto.randomUUID().replace(/-/g, "").slice(0, 25);
            await pool.query(`
                INSERT INTO "User" (id, email, name, password, role, "createdAt", "updatedAt")
                VALUES ($1, 'admin@zencrm.com', 'Administrador', $2, 'ADMIN', NOW(), NOW())
                ON CONFLICT (email) DO NOTHING
            `, [adminId, adminPassword]);
            console.log("[Startup] ✓ Admin user (admin@zencrm.com / admin123)");

            // Pipeline Stages
            const stages = [
                { name: "Nuevo Lead", color: "#3B82F6", order: 0, isIncoming: true, isClosedWon: false, isClosedLost: false },
                { name: "Calificado", color: "#8B5CF6", order: 1, isIncoming: false, isClosedWon: false, isClosedLost: false },
                { name: "Propuesta", color: "#F59E0B", order: 2, isIncoming: false, isClosedWon: false, isClosedLost: false },
                { name: "Negociación", color: "#F97316", order: 3, isIncoming: false, isClosedWon: false, isClosedLost: false },
                { name: "Cerrado Ganado", color: "#22C55E", order: 4, isIncoming: false, isClosedWon: true, isClosedLost: false },
                { name: "Cerrado Perdido", color: "#EF4444", order: 5, isIncoming: false, isClosedWon: false, isClosedLost: true },
            ];

            for (const s of stages) {
                const id = crypto.randomUUID().replace(/-/g, "").slice(0, 25);
                await pool.query(`
                    INSERT INTO "PipelineStage" (id, name, color, "order", "isIncoming", "isClosedWon", "isClosedLost", "createdAt", "updatedAt")
                    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
                `, [id, s.name, s.color, s.order, s.isIncoming, s.isClosedWon, s.isClosedLost]);
            }
            console.log("[Startup] ✓ " + stages.length + " pipeline stages");
            console.log("[Startup] ✅ Auto-seed complete!");
        }
    } catch (err) {
        console.error("[Startup] Error:", err.message);
    } finally {
        await pool.end();
    }
}

await startup();

// ── 3. Start the server ──
console.log("[Startup] Starting Next.js server...");
import("./server.js");
