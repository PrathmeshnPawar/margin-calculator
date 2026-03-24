import { getDb } from "./db";

/* ── segment map ── */
const SEG: Record<string, string> = {
    NFO: "NSEFO",
    BFO: "BSEFO",
    NCD: "NSECD",
    BCD: "BSCCD",
};

function seg(exchange: string): string {
    return SEG[exchange] ?? exchange;
}

/* ── Find exchange token (used for margin API) ── */
export async function findToken(
    symbol: string,
    expiry: string,
    strike: number,
    optionType: string,
    exchange: string
): Promise<number | null> {
    const db = await getDb();
    const isFutures = optionType === "XX" || !strike || strike === 0;

    const filter = isFutures
        ? { symbol, expiry_date: expiry, exchange_seg: seg(exchange), option_type: "XX" }
        : { symbol, expiry_date: expiry, exchange_seg: seg(exchange), strike_price: Number(strike), option_type: optionType };

    console.log("findToken filter:", filter);
    const doc = await db.collection("contracts").findOne(filter, { projection: { exchange_token: 1 } });
    console.log("findToken result:", doc);
    return doc?.exchange_token ?? null;
}

/* ── Find greek token (used for quote API) ── */
export async function findGreekToken(
    symbol: string,
    expiry: string,
    strike: number,
    optionType: string,
    exchange: string
): Promise<number | null> {
    const db = await getDb();
    const isFutures = optionType === "XX" || !strike || strike === 0;

    const filter = isFutures
        ? { symbol, expiry_date: expiry, exchange_seg: seg(exchange), option_type: "XX" }
        : { symbol, expiry_date: expiry, exchange_seg: seg(exchange), strike_price: Number(strike), option_type: optionType };

    console.log("findGreekToken filter:", filter);
    const doc = await db.collection("contracts").findOne(filter, { projection: { greek_token: 1 } });
    console.log("findGreekToken result:", doc);
    return doc?.greek_token ?? null;
}

/* ── Get distinct symbols for a given exchange ── */
export async function getAllSymbols(exchange: string) {
    const db = await getDb();
    const docs = await db.collection("contracts").aggregate([
        {
            $match: {
                exchange_seg: seg(exchange),
                expiry_date: { $ne: null },
                inst_type: { $in: ["FUTIDX", "FUTSTK", "OPTIDX", "OPTSTK"] },
            }
        },
        {
            $group: {
                _id: "$symbol",
                lot_size: { $first: "$lot_size" },
            }
        },
        { $sort: { _id: 1 } },
        {
            $project: {
                _id: 0,
                symbol: "$_id",
                lot_size: 1,
            }
        }
    ]).toArray();
    return docs;
}

/* ── Get expiries for a symbol+exchange ── */
export async function getExpiries(symbol: string, exchange: string): Promise<string[]> {
    const db = await getDb();
    const docs = await db.collection("contracts").distinct("expiry_date", {
        symbol,
        exchange_seg: seg(exchange),
        expiry_date: { $ne: null },
    });
    return (docs as string[]).sort();
}

/* ── Get strikes for a symbol+expiry+exchange ── */
export async function getStrikes(symbol: string, expiry: string, exchange: string): Promise<number[]> {
    const db = await getDb();
    const docs = await db.collection("contracts").distinct("strike_price", {
        symbol,
        expiry_date: expiry,
        exchange_seg: seg(exchange),
        option_type: { $ne: "XX" },
    });
    return (docs as number[]).map(Number).sort((a, b) => a - b);
}