export async function GET() {
    return Response.json({
        token: process.env.SESSION_TOKEN,
        gcid: process.env.GCID,          // ← add GCID to .env.local
    });
}
