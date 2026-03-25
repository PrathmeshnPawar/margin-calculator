import { getSession } from "@/lib/session";

export async function GET() {
    const { sessionToken, gcid } = await getSession();
    return Response.json({ sessionToken, gcid });
}

export { GET as POST };