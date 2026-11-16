/** 성도명 + (동명이인 구분 표기: 연락처 뒷4자리 또는 직분). 표기는 작고 옅은 글씨라 이름이 먼저 눈에 들어옵니다. */
export function NameWithTag({ name, tag }: { name: string; tag: string | null }) {
  return (
    <>
      {name}
      {tag ? <span className="name-tag ml-1 text-[0.72em] font-normal text-gray-500">({tag})</span> : null}
    </>
  );
}
