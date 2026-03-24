import { MongoClient, Db } from "mongodb";

const uri = process.env.MONGODB_URI!;

let client: MongoClient;
let db: Db;

declare global {
    // eslint-disable-next-line no-var
    var _mongoClient: MongoClient | undefined;
}

async function getClient(): Promise<MongoClient> {
    if (process.env.NODE_ENV === "development") {
        // Reuse connection in dev — avoids exhausting connections on hot reload
        if (!global._mongoClient) {
            global._mongoClient = new MongoClient(uri);
            await global._mongoClient.connect();
        }
        return global._mongoClient;
    }

    // Production — create a new client per cold start
    if (!client) {
        client = new MongoClient(uri);
        await client.connect();
    }
    return client;
}

export async function getDb(): Promise<Db> {
    const c = await getClient();
    return c.db(process.env.MONGODB_DB_NAME ?? "mydb");
}