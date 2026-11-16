import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppProviders } from './contexts/AppProviders';
import { openStorage } from './services/storage/storageService';
import { applyStoredTheme } from './services/theme';
import './index.css';

applyStoredTheme();

function showFatal(err: unknown): void {
  const root = document.getElementById('root');
  if (!root) return;
  const msg = err instanceof Error ? err.message : String(err);
  root.innerHTML = '';
  const box = document.createElement('div');
  box.style.cssText = 'max-width:40rem;margin:4rem auto;padding:1.5rem;border:1px solid #fca5a5;background:#fef2f2;color:#991b1b;font-family:sans-serif;line-height:1.6';
  box.textContent = `데이터를 불러오는 중 오류가 발생했습니다. 데이터는 지워지지 않았습니다. 앱을 닫았다가 다시 실행해 보시고, 계속되면 이 메시지를 알려 주세요. (${msg})`;
  root.appendChild(box);
}

async function bootstrap() {
  try {
    await openStorage();
  } catch (err) {
    // 빈 화면 대신 안내를 보여 줍니다(데이터는 그대로 남아 있고 다음 실행에서 다시 시도).
    showFatal(err);
    return;
  }
  // 브라우저 저장소 자동 정리 대상에서 제외 요청 (Electron에서는 userData에 보존됨)
  void navigator.storage?.persist?.();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppProviders>
        <App />
      </AppProviders>
    </StrictMode>,
  );
}

void bootstrap();
