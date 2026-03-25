import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

async function getCredentials() {
    return await getSession();
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const gscid = process.env.GSCID;

        if (!gscid) {
            return NextResponse.json({ error: "GSCID not configured" }, { status: 500 });
        }

        const { sessionToken } = await getCredentials();

        if (!sessionToken) {
            return NextResponse.json({ error: "Session token unavailable" }, { status: 401 });
        }

        const safeBody = {
            request: {
                ...body.request,
                data: { ...body.request.data, gscid },
            },
        };

        console.log("Margin API payload:", JSON.stringify(safeBody));

        const externalResponse = await fetch(
            "http://restapi.greeksoft.in:7267/MarginCalculatorAPI",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": sessionToken,
                },
                body: JSON.stringify(safeBody),
                signal: AbortSignal.timeout(10000), // fail after 10s
            }
        );

        console.log("Margin API status:", externalResponse.status);

        // Read as text first — avoids "Unexpected end of JSON" if body is empty
        const raw = await externalResponse.text();
        console.log("Margin API raw response:", raw?.slice(0, 300));

        if (!raw) {
            console.warn("Margin API returned empty body");
            return NextResponse.json({ spanMargin: 0, expMargin: 0, netPremium: 0 });
        }

        if (!externalResponse.ok) {
            console.error("Margin API error status:", externalResponse.status, raw);
            // Return zeros so premium still shows in UI
            return NextResponse.json({ spanMargin: 0, expMargin: 0, netPremium: 0 });
        }

        const data = JSON.parse(raw);

        if (data?.response?.Error) {
            console.warn("Greeksoft margin error:", data.response.Error);
            return NextResponse.json(
                { error: `Greeksoft: ${data.response.Error}` },
                { status: 502 }
            );
        }

        const marginData = data?.response?.data;
        if (!marginData) {
            console.warn("No marginData in response:", data);
            return NextResponse.json({ spanMargin: 0, expMargin: 0, netPremium: 0 });
        }

        return NextResponse.json({
            spanMargin: marginData.NewPosSpanMargin ?? 0,
            expMargin:  marginData.NewPosExpMargin  ?? 0,
            netPremium: marginData.NewPosPremium    ?? 0,
        });

    } catch (error: any) {
        console.error("Margin route error:", error.message);
        // Return zeros instead of crashing — premium will still show
        return NextResponse.json({ spanMargin: 0, expMargin: 0, netPremium: 0 });
    }
}