/**
 * 인쇄 전용 여백 행. 인쇄 여백을 0으로 두면(브라우저 머리글·바닥글 제거 목적) 2쪽 이후에는 위·아래 여백이 없으므로,
 * 표의 머리글(thead)·바닥글(tfoot)에 이 행을 넣어 쪽마다 최소 여백을 반복해서 확보합니다. 화면에서는 보이지 않습니다.
 */
export function SpacerRow({ cols }: { cols: number }) {
  return (
    <tr className="print-spacer" aria-hidden="true">
      <td colSpan={cols} />
    </tr>
  );
}
