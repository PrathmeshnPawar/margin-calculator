declare global {
  var _sessionCache: {
    token: string;
    gcid: string;
    expiry: number;
  } | undefined;
}

export async function getSession(): Promise<{ sessionToken: string; gcid: string }> {
    if (global._sessionCache && Date.now() < global._sessionCache.expiry) {
        return { sessionToken: global._sessionCache.token, gcid: global._sessionCache.gcid };
    }

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

    global._sessionCache = {
        token:  data.sessionToken,
        gcid:   String(data.id),
        expiry: Date.now() + 60 * 60 * 1000,
    };

    return { sessionToken: global._sessionCache.token, gcid: global._sessionCache.gcid };
}