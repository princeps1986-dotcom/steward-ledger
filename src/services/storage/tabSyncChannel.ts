// BroadcastChannel 기반 다중 창 동기화. 같은 객체에는 메시지가 돌아오지 않으므로 자기 변경은 수신되지 않습니다.
type Listener = (keys: string[]) => void;

const CHANNEL = 'church-offering-ledger-sync';
const channel: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;
const listeners = new Set<Listener>();

channel?.addEventListener('message', (ev: MessageEvent<{ type: string; keys: string[] }>) => {
  if (ev.data?.type === 'changed' && Array.isArray(ev.data.keys)) {
    for (const l of listeners) l(ev.data.keys);
  }
});

export function broadcastChanged(keys: string[]): void {
  channel?.postMessage({ type: 'changed', keys });
}

export function subscribeExternalChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
