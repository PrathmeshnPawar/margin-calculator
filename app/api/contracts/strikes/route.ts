import { getStrikes } from "@/lib/contracts";

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get("symbol");
    const expiry = searchParams.get("expiry");
    const exchange = searchParams.get("exchange") ?? "NFO";

    if (!symbol || !expiry) return Response.json({ strikes: [], ltp: 0 });

    const strikes = await getStrikes(symbol, expiry, exchange);
    const ltp = strikes.length > 0 ? strikes[Math.floor(strikes.length / 2)] : 0;

    return Response.json({ strikes, ltp });
}