import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { MongoClient } from "mongodb";
import * as csv from "csv-parse/sync";
import crypto from "crypto";

const client = new MongoClient(process.env.MONGODB_URI!);

function parseExpiry(raw?: string): string | null {
    if (!raw) return null;

    const str = raw.trim().toUpperCase();

    const months: Record<string, string> = {
        JAN: "01", FEB: "02", MAR: "03", APR: "04",
        MAY: "05", JUN: "06", JUL: "07", AUG: "08",
        SEP: "09", OCT: "10", NOV: "11", DEC: "12",
    };

    const match4 = str.match(/^(\d{2})([A-Z]{3})(\d{4})$/);
    if (match4) {
        const [, day, mon, year] = match4;
        return `${year}-${months[mon]}-${day}`;
    }

    const match2 = str.match(/^(\d{2})([A-Z]{3})(\d{2})$/);
    if (match2) {
        const [, day, mon, year] = match2;
        return `20${year}-${months[mon]}-${day}`;
    }

    return null;
}

async function seed() {
    try {
        await client.connect();
        const db = client.db(process.env.MONGODB_DB_NAME ?? "mydb");
        const collection = db.collection("contracts");

        console.log("Fetching contract master from Greeksoft...");

        const res = await fetch("http://restapi.greeksoft.in:3434/getAllContract", {
            headers: {
                "Authorization": process.env.SESSION_TOKEN!,
            },
        });

        if (!res.ok) {
            throw new Error(`Greeksoft responded with ${res.status}`);
        }

        const text = await res.text();
        const cleanText = text.replace(/^\uFEFF/, ""); // Strip BOM

        // ── Hash check — skip insert if file hasn't changed ──
        const hash = crypto.createHash("md5").update(cleanText).digest("hex");
        const metaCol = db.collection("meta");
        const existing = await metaCol.findOne({ key: "contracts_hash" });

        if (existing?.value === hash) {
            console.log(`✅ Contract file unchanged (hash: ${hash}) — skipping insert`);
            return;
        }

        console.log(`New contract file detected (hash: ${hash}) — proceeding with insert`);

        const rows = csv.parse(cleanText, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
            bom: true,
            relax_column_count: true,
        });

        console.log(`Parsed ${rows.length} contracts.`);

        // Debug: NFO rows
        const nfoRows = rows.filter((r: any) => r["ExchangeSegMent"]?.trim() === "NSEFO");
        console.log("NFO count:", nfoRows.length);
        if (nfoRows.length > 0) {
            const sample = nfoRows[0] as any;
            console.log("First NFO row:", JSON.stringify(sample));
            console.log("Raw expiry:", JSON.stringify(sample["ExpiryDate"]));
            console.log("Parsed expiry:", parseExpiry(sample["ExpiryDate"]));
            console.log("Char codes:", [...(sample["ExpiryDate"] ?? "")].map((c: string) => c.charCodeAt(0)));
        }

        // Debug: all segments
        const segments = [...new Set(rows.map((r: any) => r["ExchangeSegMent"]?.trim()))];
        console.log("All segments:", segments);

        // Build documents
        const docs = (rows as any[]).map((row) => ({
            greek_token:    Number(row["GreekToken"]),
            exchange_token: Number(row["ExchangeToken"]),
            exchange_seg:   row["ExchangeSegMent"]?.trim(),
            inst_type:      row["Series/InstType"]?.trim(),
            symbol:         row["Symbol"]?.trim(),
            description:    row["Description"]?.trim(),
            expiry_date:    parseExpiry(row["ExpiryDate"]),
            option_type:    row["OptionType"]?.trim() || "XX",
            strike_price:   Number(row["StrikePrice"]) || 0,
            tick_size:      Number(row["TickSize"]) || 0,
            lot_size:       Number(row["LotSize"]) || 1,
            trading_symbol: row["TradingSymbol"]?.trim(),
            symbol_expiry:  row["SymbolWithExpiry"]?.trim(),
        }));

        console.log("Inserting...");

        // Drop the entire collection and recreate — fastest possible full refresh
        await collection.drop().catch(() => {}); // ignore error if collection doesn't exist yet

        // insertMany is 10-20x faster than bulkWrite upserts for full reseeds
        const BATCH_SIZE = 5000;
        let inserted = 0;

        for (let i = 0; i < docs.length; i += BATCH_SIZE) {
            const batch = docs.slice(i, i + BATCH_SIZE);
            await collection.insertMany(batch, { ordered: false });
            inserted += batch.length;
            console.log(`  Inserted ${inserted} / ${docs.length}`);
        }

        // Recreate indexes AFTER insert — building indexes on empty collection first is slower
        await collection.createIndex({ greek_token: 1 }, { unique: true });
        await collection.createIndex({ symbol: 1, exchange_seg: 1 });
        await collection.createIndex({ symbol: 1, expiry_date: 1, strike_price: 1, option_type: 1 });

        // Save hash so next run can compare
        await metaCol.updateOne(
            { key: "contracts_hash" },
            { $set: { value: hash, updatedAt: new Date(), rowCount: docs.length } },
            { upsert: true }
        );

        console.log(`✅ Seed complete — ${inserted} contracts inserted`);

    } catch (err) {
        console.error("❌ Seed failed:", err);
    } finally {
        await client.close();
    }
}

seed();