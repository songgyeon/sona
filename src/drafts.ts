/* 임시저장한 필름을 두는 곳 — 이 브라우저의 저장소. 셈은 shared/draft.ts의 shelf에 있다. */

import { shelf } from '../shared/draft';
import { newId } from './api';

export const drafts = shelf(() => localStorage, newId, () => Date.now());
