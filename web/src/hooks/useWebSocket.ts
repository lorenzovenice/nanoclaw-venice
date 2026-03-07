import { useCallback, useEffect, useRef, useState } from 'react';

type MessageHandler = (data: unknown) => void;

export function useWebSocket(url = '/ws') {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, Set<MessageHandler>>>(new Map());
  const reconnectRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}${url}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      reconnectRef.current = setTimeout(connect, 3000);
    };
    ws.onerror = () => {};

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string) as {
          type?: string;
          data?: unknown;
          payload?: unknown;
        };
        const type = msg.type || 'message';
        const payload = msg.payload ?? msg.data ?? msg;
        handlersRef.current.get(type)?.forEach((h) => h(payload));
        handlersRef.current.get('*')?.forEach((h) => h(msg));
      } catch {
        // ignore parse errors
      }
    };

    wsRef.current = ws;
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const subscribe = useCallback((type: string, handler: MessageHandler) => {
    if (!handlersRef.current.has(type)) {
      handlersRef.current.set(type, new Set());
    }
    handlersRef.current.get(type)!.add(handler);
    return () => {
      handlersRef.current.get(type)?.delete(handler);
    };
  }, []);

  return { connected, subscribe };
}
