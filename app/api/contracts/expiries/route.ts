import { getExpiries } from "@/lib/contracts";

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get("symbol");
    const exchange = searchParams.get("exchange") ?? "NFO";

    if (!symbol) return Response.json({ expiries: [] });

    const expiries = await getExpiries(symbol, exchange);
    return Response.json({ expiries });
}