import { useCallback, useMemo } from 'react';
import { useMemberById, useMembers } from '../contexts/MemberContext';
import { duplicateNames, memberOrderKey, nameDisambiguator } from '../services/domain/memberName';

/**
 * 보고서에서 성도명 옆에 작게 붙일 구분 표기를 돌려주는 함수.
 * 동명이인이면 연락처 뒷4자리(없으면 직분), 아니면 null. 무명/방문자(memberId null)는 항상 null입니다.
 */
export function useNameTag(): (memberId: string | null | undefined) => string | null {
  const members = useMembers();
  const memberById = useMemberById();
  const dup = useMemo(() => duplicateNames(members), [members]);
  return useCallback((memberId) => (memberId ? nameDisambiguator(memberById.get(memberId), dup) : null), [memberById, dup]);
}

/** 동명이인 정렬 보조 키 함수(연락처 뒷4자리 → 직분 → id). 주별 보고서 화면·엑셀이 같은 순서를 쓰게 합니다. */
export function useMemberOrderKey(): (memberId: string) => string {
  const memberById = useMemberById();
  return useCallback((memberId) => memberOrderKey(memberById.get(memberId)), [memberById]);
}
