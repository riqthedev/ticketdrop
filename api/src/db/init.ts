import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getClient } from './index';

export async function initDatabase(): Promise<void> {
  const client = await getClient();
  
  try {
    // Get the directory of the current file
    const currentDir = typeof __dirname !== 'undefined' 
      ? __dirname 
      : dirname(fileURLToPath(import.meta.url));
    
    // Try multiple possible paths
    let sqlPath = join(currentDir, '../../db/init.sql');
    try {
      readFileSync(sqlPath, 'utf-8');
    } catch {
      // Try alternative path
      sqlPath = join(process.cwd(), 'db/init.sql');
    }
    
    const sql = readFileSync(sqlPath, 'utf-8');
    
    // Split by semicolon and filter out empty/comment-only statements
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.match(/^--/));

    // Execute each statement
    for (const statement of statements) {
      if (statement.trim()) {
        try {
          await client.query(statement);
        } catch (error: any) {
          // Ignore "already exists" errors
          if (error.code !== '42P07' && error.code !== '42710' && error.code !== '23505') {
            throw error;
          }
        }
      }
    }

    console.log('Database initialized successfully');
  } catch (error: any) {
    console.error('Failed to initialize database:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  initDatabase()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

