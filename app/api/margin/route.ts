import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

async function getCredentials() {
    return await getSession();
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const gscid = process.env.GSCID;

        if (!gscid) return NextResponse.json({ error: 'GSCID not configured' }, { status: 500 });

        const { sessionToken } = await getCredentials();

        if (!sessionToken) return NextResponse.json({ error: 'Session token unavailable' }, { status: 401 });

        const safeBody = {
            request: {
                ...body.request,
                data: { ...body.request.data, gscid },
            },
        };

        const externalResponse = await fetch(
            "http://restapi.greeksoft.in:7267/MarginCalculatorAPI",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": sessionToken,
                },
                body: JSON.stringify(safeBody),
            }
        );

        const raw = await externalResponse.text();
        const data = JSON.parse(raw);

        if (data?.response?.Error) {
            return NextResponse.json(
                { error: `Greeksoft: ${data.response.Error}` },
                { status: 502 }
            );
        }

        const marginData = data?.response?.data;
        if (!marginData) {
            return NextResponse.json({ error: 'Invalid response from Greeksoft' }, { status: 502 });
        }

        return NextResponse.json({
            spanMargin: marginData.NewPosSpanMargin ?? 0,
            expMargin:  marginData.NewPosExpMargin  ?? 0,
            netPremium: marginData.NewPosPremium    ?? 0,
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}