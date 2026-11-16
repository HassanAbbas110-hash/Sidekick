// Line icons drawn for Sidekick: one stroke weight, round ends, no fills, so they sit quietly next to text.
const P = { viewBox: '0 0 24 24', width: 22, height: 22, className: 'icon', 'aria-hidden': true } as const;

export const IconToday = () => <svg {...P}><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></svg>;
export const IconWeek = () => <svg {...P}><path d="M5 20V12M9.7 20V7M14.3 20V10M19 20V4" /></svg>;
export const IconCalendar = () => <svg {...P}><rect x="3.5" y="5" width="17" height="15" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>;
export const IconSpaces = () => <svg {...P}><rect x="4" y="4" width="7" height="7" rx="2" /><rect x="13" y="4" width="7" height="7" rx="2" /><rect x="4" y="13" width="7" height="7" rx="2" /><rect x="13" y="13" width="7" height="7" rx="2" /></svg>;
export const IconSearch = () => <svg {...P}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>;
export const IconLock = () => <svg {...P}><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" /></svg>;
