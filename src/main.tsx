import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppProviders } from './contexts/AppProviders';
import { recoverJournal } from './services/storage/storageService';
import { applyStoredTheme } from './services/theme';
import './index.css';

applyStoredTheme();

async function bootstrap() {
  // 지난 실행에서 커밋 도중 종료된 트랜잭션이 있으면 먼저 재적용합니다.
  await recoverJournal();
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
