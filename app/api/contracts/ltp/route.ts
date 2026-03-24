// api/contracts/ltp/route.ts
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
    try {
        const { token, exchange_segment } = await req.json();
        const authToken = process.env.SESSION_TOKEN;

        if (!authToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const response = await fetch("http://restapi.greeksoft.in:7267/getQuoteForSingleSymbol_V2", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": authToken,
            },
            body: JSON.stringify({
                request: {
                    data: { token, exchange_segment },
                }
            }),
        });

        const data = await response.json();
        const ltp = data?.response?.data?.LastTradedPrice ?? 0;

        return NextResponse.json({ ltp });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch LTP' }, { status: 500 });
    }
}