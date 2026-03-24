import { findToken, findGreekToken } from "@/lib/contracts";

export async function POST(req: Request) {
    const { symbol, expiry, strike, optionType, exchange } = await req.json();

    // Always return both — margin API needs token, quote API needs greekToken
    const [token, greekToken] = await Promise.all([
        findToken(symbol, expiry, Number(strike), optionType, exchange),
        findGreekToken(symbol, expiry, Number(strike), optionType, exchange),
    ]);

    return Response.json({ token, greekToken });
}