import { query } from './index';

async function addPausedColumn() {
  try {
    console.log('Adding paused column to events table...');
    
    await query(`
      ALTER TABLE events 
      ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT false;
    `);
    
    console.log('✅ Paused column added successfully');
  } catch (error: any) {
    console.error('❌ Error adding paused column:', error.message);
    throw error;
  }
}

if (require.main === module) {
  addPausedColumn()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export default addPausedColumn;

