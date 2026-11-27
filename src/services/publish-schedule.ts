export const MAX_DAILY_POSTS = 5;
const opensAt = 9 * 60;
const closesAt = 21 * 60;

function slotMinute(index: number, dailyLimit: number): number {
  return opensAt + Math.floor(index * (closesAt - opensAt) / dailyLimit);
}

export function publicationTimes(dailyLimit: number): string {
  return Array.from({ length: dailyLimit }, (_, index) => {
    const minute = slotMinute(index, dailyLimit);
    return [Math.floor(minute / 60), minute % 60].map((part) => String(part).padStart(2, '0')).join(':');
  }).join(', ');
}

export class PublishSchedule {
  private readonly clock: Intl.DateTimeFormat;

  constructor(timeZone: string) {
    this.clock = new Intl.DateTimeFormat('en', { timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
  }

  private localMinute(now: number): number {
    const parts = this.clock.formatToParts(now);
    return Number(parts.find((part) => part.type === 'hour')?.value) * 60 +
      Number(parts.find((part) => part.type === 'minute')?.value);
  }

  isOpen(now: number): boolean {
    const minute = this.localMinute(now);
    return minute >= opensAt && minute < closesAt;
  }

  currentSlots(now: number): { dailyLimit: number; startsAt: number }[] {
    const minute = this.localMinute(now);
    if (minute < opensAt || minute >= closesAt) return [];
    const localMidnight = Math.floor(now / 60_000) * 60_000 - minute * 60_000;
    return Array.from({ length: MAX_DAILY_POSTS }, (_, index) => {
      const dailyLimit = index + 1;
      let slot = dailyLimit - 1;
      while (slotMinute(slot, dailyLimit) > minute) slot--;
      return { dailyLimit, startsAt: localMidnight + slotMinute(slot, dailyLimit) * 60_000 };
    });
  }
}
