const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]+$/;

export const isValidEmail = (s: string): boolean => EMAIL_RE.test(s.trim());

/** 기본 메일 앱을 엽니다. Electron에서는 main 프로세스가 mailto: 탐색을 가로채 OS에 넘깁니다. */
export function openMailto(to: string, subject: string, body: string): void {
  if (!isValidEmail(to)) throw new Error('수신 메일 주소가 올바르지 않습니다.');
  const url = `mailto:${encodeURIComponent(to.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const a = document.createElement('a');
  a.href = url;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
