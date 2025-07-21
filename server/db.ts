import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

// Handle missing DATABASE_URL for development
if (!process.env.DATABASE_URL) {
  console.warn(
    "DATABASE_URL is not set. This may cause database operations to fail."
  );
  console.warn(
    "For development, please set DATABASE_URL in your environment or .env file."
  );
  // Set a placeholder URL to allow the application to start
  process.env.DATABASE_URL = "postgresql://placeholder:placeholder@placeholder:5432/placeholder";
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle({ client: pool, schema });
