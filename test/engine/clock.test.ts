import { describe, expect, it } from 'vitest';
import { DAY, dowPart, endOfToday, formatWorld, inSpan, nextWake, partOfDay, trialOver, worldAt } from '../../shared/clock';

// 금요일 오후 4시에 시작하는 필름
const fri4pm = (elapsed: number) => ({ startDow: 5, startMin: 16 * 60, elapsed });

describe('작중 시계', () => {
  it('흐른 분만큼 간다', () => {
    expect(formatWorld(fri4pm(0))).toBe('금요일 오후 4:00');
    expect(formatWorld(fri4pm(3))).toBe('금요일 오후 4:03');
    // 자정부터 1시 전까지는 앞 요일의 밤이다. 「토요일 오전 12:00」이 아니라 「금요일 밤 12:00」
    expect(formatWorld(fri4pm(8 * 60))).toBe('금요일 밤 12:00');
    expect(formatWorld(fri4pm(8 * 60 + 59))).toBe('금요일 밤 12:59');
    expect(formatWorld(fri4pm(9 * 60))).toBe('토요일 오전 1:00');
    expect(dowPart(6, 30)).toBe('금요일 밤');
    expect(dowPart(6, 60)).toBe('토요일 새벽');
    // 일요일 자정은 토요일 밤이다(요일이 한 바퀴 돈다)
    expect(dowPart(0, 0)).toBe('토요일 밤');
    expect(worldAt(fri4pm(24 * 60))).toEqual({ dow: 6, min: 16 * 60, day: 1 });
    // 이야기 전으로 거슬러 가도 요일이 돈다: 월요일 아침 7시에 시작해 이틀 전 밤 11시는 토요일
    const mon7am = { startDow: 1, startMin: 7 * 60, elapsed: 0 };
    expect(formatWorld(mon7am, -(DAY + 8 * 60))).toBe('토요일 오후 11:00');
    expect(formatWorld(mon7am, -(2 * DAY + 8 * 60))).toBe('금요일 오후 11:00');
    expect(worldAt(mon7am, -7 * DAY).dow).toBe(1);
    expect(formatWorld(mon7am, -60)).toBe('월요일 오전 6:00');
  });

  it('「오늘」은 다음 새벽 5시에 끝난다', () => {
    // 금 16:00 → 토 05:00
    expect(endOfToday(fri4pm(0))).toBe(13 * 60);
    // 토 02:00(자정을 넘긴 밤) → 같은 날 05:00. 새벽 두 시의 「오늘」은 아직 금요일 밤이다
    expect(endOfToday(fri4pm(10 * 60))).toBe(13 * 60);
    // 토 05:00 정각 → 일 05:00
    expect(endOfToday(fri4pm(13 * 60))).toBe(37 * 60);
  });

  it('자고 오면 다음 아침 7시다', () => {
    expect(nextWake(fri4pm(0))).toBe(15 * 60);
    expect(formatWorld(fri4pm(nextWake(fri4pm(0))))).toBe('토요일 오전 7:00');
    // 새벽 3시에 자면 같은 날 아침
    expect(nextWake(fri4pm(11 * 60))).toBe(15 * 60);
  });

  it('자정을 넘기는 구간도 안다', () => {
    expect(inSpan(30, 23 * 60, 7 * 60)).toBe(true);
    expect(inSpan(23 * 60 + 30, 23 * 60, 7 * 60)).toBe(true);
    expect(inSpan(12 * 60, 23 * 60, 7 * 60)).toBe(false);
    expect(inSpan(2 * 60, 60, 8 * 60)).toBe(true);
    expect(inSpan(8 * 60, 60, 8 * 60)).toBe(false);
  });

  it('때를 말로 바꾼다', () => {
    expect(partOfDay(3 * 60)).toBe('새벽');
    expect(partOfDay(8 * 60)).toBe('아침');
    expect(partOfDay(16 * 60)).toBe('낮');
    expect(partOfDay(19 * 60)).toBe('저녁');
    expect(partOfDay(22 * 60)).toBe('밤');
  });

  it('체험은 24시간이다', () => {
    expect(trialOver(24 * 60 - 1)).toBe(false);
    expect(trialOver(24 * 60)).toBe(true);
  });
});
