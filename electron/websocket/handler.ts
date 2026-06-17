import WebSocket from 'ws';
import { BrowserWindow } from 'electron';
import { addDocument, addDocuments, deleteChunksByDocumentId, searchDocuments } from '../lancedb/operations';
import { DocumentData } from '../lancedb/types';

let ws: WebSocket | null = null;
let wsUrl: string | null = null;
let wsToken: string | null = null;
let syncEnabled = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectAttempts = 0;

const MAX_RECONNECT_ATTEMPTS = 5;

function notifyRenderer(mainWindow: BrowserWindow | null, channel: string, data: any) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

export function connectWebSocket(mainWindow: BrowserWindow | null) {
  if (!wsUrl) {
    console.log('⚠️ [WebSocket] No WebSocket URL configured');
    return;
  }

  if (!wsToken) {
    console.log('⚠️ [WebSocket] No access token configured');
    notifyRenderer(mainWindow, 'sync-error', {
      message: 'WebSocket 연결 실패: 인증 토큰이 없습니다. 다시 로그인해주세요.'
    });
    return;
  }

  if (ws) {
    console.log('⚠️ [WebSocket] Already connected');
    return;
  }

  try {
    console.log('🔌 [WebSocket] Connecting to:', wsUrl);

    ws = new WebSocket(wsUrl, {
      headers: {
        'Authorization': `Bearer ${wsToken}`
      }
    });

    ws.on('open', () => {
      console.log('✅ [WebSocket] Connected');
      reconnectAttempts = 0;
      notifyRenderer(mainWindow, 'websocket-status', { connected: true });
    });

    ws.on('message', async (data) => {
      console.log('📨 [WebSocket] Message received:', data.toString());

      try {
        const message = JSON.parse(data.toString());

        // Handle request-response pattern
        if (message.request_id) {
          await handleRequest(message, mainWindow);
        } else if (message.type === 'retrieve') {
          // Legacy retrieve handler
          await handleRetrieve(message);
        }

        notifyRenderer(mainWindow, 'websocket-message', { data: message });
      } catch (error) {
        console.error('❌ [WebSocket] Error handling message:', error);
        notifyRenderer(mainWindow, 'websocket-message', { data: data.toString() });
      }
    });

    ws.on('error', (error) => {
      console.error('❌ [WebSocket] Error:', error);
      reconnectAttempts++;

      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        const errorMessage = error.message.includes('403')
          ? 'WebSocket 연결 실패: 인증 오류 (403). 다시 로그인해주세요.'
          : error.message.includes('404')
          ? 'WebSocket 연결 실패: 서버를 찾을 수 없습니다.'
          : `WebSocket 연결 실패: ${error.message}`;

        console.log(`⚠️ [WebSocket] Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached`);
        notifyRenderer(mainWindow, 'sync-error', { message: errorMessage });

        syncEnabled = false;
        notifyRenderer(mainWindow, 'sync-status', { enabled: false });
      }

      notifyRenderer(mainWindow, 'websocket-status', { connected: false, error: error.message });
    });

    ws.on('close', () => {
      console.log('🔌 [WebSocket] Disconnected');
      ws = null;
      notifyRenderer(mainWindow, 'websocket-status', { connected: false });

      if (syncEnabled && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        console.log(`🔄 [WebSocket] Reconnecting in 5 seconds... (attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);
        reconnectTimer = setTimeout(() => {
          connectWebSocket(mainWindow);
        }, 5000);
      } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.log('❌ [WebSocket] Stopped reconnecting after max attempts');
        syncEnabled = false;
        notifyRenderer(mainWindow, 'sync-status', { enabled: false });
      }
    });
  } catch (error) {
    console.error('❌ [WebSocket] Connection failed:', error);
    ws = null;
  }
}

async function handleRequest(message: any, mainWindow: BrowserWindow | null) {
  const { request_id, action, data } = message;

  try {
    if (action === 'delete_chunks') {
      console.log('🗑️ [WebSocket] Delete chunks request for document_id:', data.document_id);
      const deletedCount = await deleteChunksByDocumentId(String(data.document_id));
      sendResponse(request_id, { deleted_count: deletedCount });
    } else if (action === 'add_documents') {
      console.log('📝 [WebSocket] Add documents request, count:', data.documents?.length);
      const documents: DocumentData[] = data.documents.map((doc: any, idx: number) => ({
        id: doc.id,
        content: doc.content || doc.metadata?.content || '',
        embedding: data.embeddings[idx],
        metadata: doc.metadata
      }));

      const result = await addDocuments(documents);
      sendResponse(request_id, { chunks_saved: result.count });
    } else if (action === 'similarity_search') {
      console.log('🔍 [WebSocket] Similarity search request, k:', data.k || 5);
      const { query_embedding, k = 5 } = data;
      const results = await searchDocuments(query_embedding, k);

      sendResponse(request_id, { results });
      console.log(`✅ [WebSocket] Sent ${results.length} search results`);
    }
  } catch (error) {
    console.error('❌ [WebSocket] Error handling request:', error);
    sendResponse(request_id, { error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

async function handleRetrieve(message: any) {
  console.log('🔍 [WebSocket] Retrieve request:', message);

  const { query, limit = 5 } = message;
  const results = await searchDocuments(query, limit);

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'retrieve_result',
      requestId: message.requestId,
      results
    }));
    console.log(`✅ [WebSocket] Sent ${results.length} results`);
  }
}

function sendResponse(requestId: string, data: any) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      request_id: requestId,
      ...data
    }));
    console.log(`✅ [WebSocket] Sent response for request: ${requestId}`);
  }
}

export function disconnectWebSocket(mainWindow: BrowserWindow | null) {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (ws) {
    console.log('🔌 [WebSocket] Disconnecting...');
    ws.close();
    ws = null;
    notifyRenderer(mainWindow, 'websocket-status', { connected: false });
  }

  reconnectAttempts = 0;
}

export function setWebSocketUrl(url: string) {
  wsUrl = url;
}

export function setWebSocketToken(token: string) {
  wsToken = token;
}

export function setSyncEnabled(enabled: boolean) {
  syncEnabled = enabled;
}

export function isSyncEnabled() {
  return syncEnabled;
}

export function getWebSocketStatus() {
  return {
    enabled: syncEnabled,
    connected: ws !== null && ws.readyState === WebSocket.OPEN,
    wsUrl
  };
}
