declare global {
    var _sessionCache: { token: string; gcid: string; expiry: number } | undefined;
}

export async function GET() {
    // Return cached session if still valid
    if (global._sessionCache && Date.now() < global._sessionCache.expiry) {
        return Response.json({
            sessionToken: global._sessionCache.token,
            gcid:         global._sessionCache.gcid,
        });
    }

    // Fetch fresh session from Greeksoft
    const res = await fetch("http://greekapi.greeksoft.in:3001/auth/greek/sessiontoken", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            username: process.env.GREEKSOFT_USERNAME,
            password: process.env.GREEKSOFT_PASSWORD,
            validFor: "1d",
        }),
    });

    const data = await res.json();

    // Save to global cache — survives Next.js hot reloads
    global._sessionCache = {
        token:  data.sessionToken,
        gcid:   String(data.id),
        expiry: Date.now() + 60 * 60 * 1000, // 1 hour
    };

    return Response.json({
        sessionToken: global._sessionCache.token,
        gcid:         global._sessionCache.gcid,
    });
}

export { GET as POST };