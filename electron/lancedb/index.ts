import * as lancedb from '@lancedb/lancedb';
import path from 'path';
import { app } from 'electron';

let db: any = null;
let currentEmbeddingDimension: number | null = null;

export async function initLanceDB() {
  try {
    const dbPath = path.join(app.getPath('userData'), 'lancedb');
    console.log('📁 [LanceDB] Initializing database at:', dbPath);
    console.log('📁 [LanceDB] LanceDB version:', lancedb);

    db = await lancedb.connect(dbPath);
    console.log('✅ [LanceDB] Database initialized successfully');
    console.log('✅ [LanceDB] DB object:', db ? 'exists' : 'null');
  } catch (error) {
    console.error('❌ [LanceDB] Initialization failed:', error);
    if (error instanceof Error) {
      console.error('❌ [LanceDB] Error stack:', error.stack);
    }
  }
}

export function getDB() {
  return db;
}

export function getCurrentDimension() {
  return currentEmbeddingDimension;
}

export function setCurrentDimension(dimension: number) {
  currentEmbeddingDimension = dimension;
}

export async function getDocumentsTable() {
  if (!db) {
    console.error('❌ [LanceDB] DB not initialized when trying to get table');
    throw new Error('LanceDB not initialized');
  }

  try {
    console.log('📋 [LanceDB] Getting table names...');
    const tableNames = await db.tableNames();
    console.log('📋 [LanceDB] Available tables:', tableNames);

    if (tableNames.includes('documents')) {
      console.log('📋 [LanceDB] Opening documents table...');
      const table = await db.openTable('documents');
      console.log('✅ [LanceDB] Documents table opened');
      return table;
    }

    console.log('⚠️ [LanceDB] Documents table not found');
    return null;
  } catch (error) {
    console.error('❌ [LanceDB] Error getting table:', error);
    if (error instanceof Error) {
      console.error('❌ [LanceDB] Error stack:', error.stack);
    }
    return null;
  }
}
