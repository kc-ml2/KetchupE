import { getDB, getCurrentDimension, setCurrentDimension, getDocumentsTable } from './index';
import { DocumentData, SearchResult } from './types';

export async function addDocument(data: DocumentData) {
  try {
    const { id, content, embedding, metadata } = data;
    const dimension = embedding.length;

    console.log(`📝 [LanceDB] Adding chunk: ${id} (dimension: ${dimension})`);

    let table = await getDocumentsTable();
    const db = getDB();

    if (!table || (getCurrentDimension() && getCurrentDimension() !== dimension)) {
      if (getCurrentDimension() && getCurrentDimension() !== dimension) {
        console.warn(`⚠️ [LanceDB] Dimension mismatch: expected ${getCurrentDimension()}, got ${dimension}`);
      }

      const tableData = [{
        id,
        content,
        vector: embedding,
        metadata: JSON.stringify(metadata || {}),
        createdAt: new Date().toISOString()
      }];

      table = await db.createTable('documents', tableData, { mode: 'overwrite' });
      setCurrentDimension(dimension);
      console.log(`✅ [LanceDB] Table created with dimension: ${dimension}`);
    } else {
      await table.add([{
        id,
        content,
        vector: embedding,
        metadata: JSON.stringify(metadata || {}),
        createdAt: new Date().toISOString()
      }]);
      console.log(`✅ [LanceDB] Chunk added: ${id}`);
    }

    return { success: true };
  } catch (error) {
    console.error('❌ [LanceDB] Error adding document:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function addDocuments(documents: DocumentData[]) {
  try {
    console.log(`📝 [LanceDB] Adding ${documents.length} chunks`);

    if (documents.length === 0) {
      return { success: true, count: 0 };
    }

    const dimension = documents[0].embedding.length;
    let table = await getDocumentsTable();
    const db = getDB();

    const tableData = documents.map(doc => ({
      id: doc.id,
      content: doc.content,
      vector: doc.embedding,
      metadata: JSON.stringify(doc.metadata || {}),
      createdAt: new Date().toISOString()
    }));

    if (!table || (getCurrentDimension() && getCurrentDimension() !== dimension)) {
      if (getCurrentDimension() && getCurrentDimension() !== dimension) {
        console.warn(`⚠️ [LanceDB] Dimension mismatch: expected ${getCurrentDimension()}, got ${dimension}`);
      }

      table = await db.createTable('documents', tableData, { mode: 'overwrite' });
      setCurrentDimension(dimension);
      console.log(`✅ [LanceDB] Table created with ${tableData.length} chunks`);
    } else {
      await table.add(tableData);
      console.log(`✅ [LanceDB] Added ${tableData.length} chunks`);
    }

    return { success: true, count: tableData.length };
  } catch (error) {
    console.error('❌ [LanceDB] Error adding documents:', error);
    return { success: false, count: 0, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function deleteChunksByDocumentId(documentId: string): Promise<number> {
  try {
    const table = await getDocumentsTable();
    if (!table) {
      console.log('⚠️ [LanceDB] No documents table found');
      return 0;
    }

    console.log(`🗑️ [LanceDB] Deleting chunks for document_id: ${documentId}`);

    // LanceDB doesn't support complex JSON filtering in delete
    // We need to: 1) Query all rows, 2) Filter by metadata, 3) Delete by IDs
    try {
      // Get row count before
      const countBefore = await table.countRows();
      console.log(`📊 [LanceDB] Rows before delete: ${countBefore}`);

      // Query all rows (inefficient but necessary)
      const allRows = await table.query().toArray();
      console.log(`📋 [LanceDB] Total rows retrieved: ${allRows.length}`);

      const idsToDelete: string[] = [];

      // Filter by metadata
      for (const row of allRows) {
        try {
          const metadata = row.metadata ? JSON.parse(row.metadata) : {};
          if (metadata.document_id === documentId) {
            idsToDelete.push(row.id);
          }
        } catch (e) {
          console.error('❌ [LanceDB] Error parsing metadata for row:', row.id, e);
        }
      }

      console.log(`🎯 [LanceDB] Found ${idsToDelete.length} chunks to delete`);

      if (idsToDelete.length === 0) {
        console.log(`⚠️ [LanceDB] No chunks found for document_id: ${documentId}`);
        return 0;
      }

      // Delete by ID (one at a time or batch)
      for (const id of idsToDelete) {
        await table.delete(`id = '${id}'`);
      }

      console.log(`✅ [LanceDB] Deleted ${idsToDelete.length} chunks`);

      const countAfter = await table.countRows();
      console.log(`📊 [LanceDB] Rows after delete: ${countAfter}`);

      return idsToDelete.length;
    } catch (deleteError) {
      console.error('❌ [LanceDB] Delete operation failed:', deleteError);
      if (deleteError instanceof Error) {
        console.error('❌ [LanceDB] Error stack:', deleteError.stack);
      }
      return 0;
    }
  } catch (error) {
    console.error('❌ [LanceDB] Delete error:', error);
    if (error instanceof Error) {
      console.error('❌ [LanceDB] Error stack:', error.stack);
    }
    return 0;
  }
}

export async function searchDocuments(query: number[], limit: number = 5): Promise<SearchResult[]> {
  try {
    const table = await getDocumentsTable();
    if (!table) {
      console.log('⚠️ [LanceDB] No documents table found');
      return [];
    }

    console.log(`🔍 [LanceDB] Searching for top ${limit} results`);

    const results = await table
      .search(query)
      .limit(limit)
      .toArray();

    console.log(`✅ [LanceDB] Found ${results.length} results`);

    return results.map((result: any) => ({
      ...result,
      metadata: result.metadata ? JSON.parse(result.metadata) : {}
    }));
  } catch (error) {
    console.error('❌ [LanceDB] Search error:', error);
    return [];
  }
}

export async function getStats() {
  try {
    const table = await getDocumentsTable();
    if (!table) {
      return { count: 0, dimension: null };
    }
    const count = await table.countRows();
    return { count, dimension: getCurrentDimension() };
  } catch (error) {
    console.error('❌ [LanceDB] Error getting stats:', error);
    return { count: 0, dimension: null, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
