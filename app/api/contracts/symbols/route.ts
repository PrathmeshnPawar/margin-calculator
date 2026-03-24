import { getAllSymbols } from "@/lib/contracts";

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const exchange = searchParams.get("exchange") ?? "NFO";
    const symbols = await getAllSymbols(exchange);
    return Response.json({ symbols });
}