/**
 * UUID helper that uses Node.js built-in crypto.randomUUID()
 * This avoids ESM/CommonJS compatibility issues with the uuid package
 * 
 * Node.js 14.17.0+ includes crypto.randomUUID() which generates RFC 4122 compliant UUIDs
 * This is the recommended approach for serverless environments like Vercel
 */

import { randomUUID } from 'crypto';

/**
 * Generates a UUID v4 string using Node.js built-in crypto.randomUUID()
 * This is synchronous, works in both CommonJS and ESM, and has no external dependencies
 * 
 * @returns A UUID v4 string (e.g., "550e8400-e29b-41d4-a716-446655440000")
 */
export function uuidv4(): string {
  return randomUUID();
}

