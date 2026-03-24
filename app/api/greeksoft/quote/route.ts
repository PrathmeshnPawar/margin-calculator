export async function POST(req: Request) {
    try {
        const { greekToken } = await req.json();

        const sessionRes = await fetch(
            `${process.env.NEXT_PUBLIC_BASE_URL}/api/greeksoft/session`
        );
        const { sessionToken, gcid } = await sessionRes.json();
        const gscid = process.env.GSCID;

        if (!sessionToken || !gcid || !gscid) {
            return Response.json({ error: "Missing credentials" }, { status: 401 });
        }

        const res = await fetch("http://restapi.greeksoft.in:3434/getQuoteForSingleSymbol_V2", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": sessionToken,
            },
            body: JSON.stringify({
                request: {
                    data: {
                        token: String(greekToken),
                        assetType: "option",
                        gscid,
                        gcid,
                    },
                    svcName: "getQuoteForSingleSymbol_V2",
                    svcGroup: "Markets",
                }
            })
        });

        if (!res.ok) return Response.json({ ltp: 0, bid: 0, ask: 0 });

        const text = await res.text();
        if (!text) return Response.json({ ltp: 0, bid: 0, ask: 0 });

        const data = JSON.parse(text);

        if (data?.error) {
            console.warn("Quote API error:", data.error);
            return Response.json({ ltp: 0, bid: 0, ask: 0 });
        }

        const q = data?.response?.data;

        const ltp = parseFloat(String(q?.last  ?? "0"))
                 || parseFloat(String(q?.close ?? "0"))
                 || 0;

        const bid = parseFloat(String(q?.bid ?? "0")) || 0;
        const ask = parseFloat(String(q?.ask ?? "0")) || 0;

        console.log("Quote:", { greekToken, ltp, bid, ask });
        console.log("Quote raw fields:", { last: q?.last, close: q?.close, bid: q?.bid, ask: q?.ask });

        return Response.json({ ltp, bid, ask });

    } catch (err) {
        console.error("Quote route error:", err);
        return Response.json({ ltp: 0, bid: 0, ask: 0 });
    }
}