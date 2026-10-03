// Published Federal Reserve meeting dates, checked on 2026-10-03.
// Future dates are tentative until confirmed at the preceding meeting.
export const FOMC_CALENDAR_SOURCE =
  "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";
export const FOMC_CALENDAR_CHECKED = "2026-10-03";
export const FOMC_MEETINGS = [
  ["2026-01-27", "2026-01-28"],
  ["2026-03-17", "2026-03-18"],
  ["2026-04-28", "2026-04-29"],
  ["2026-06-16", "2026-06-17"],
  ["2026-07-28", "2026-07-29"],
  ["2026-09-15", "2026-09-16"],
  ["2026-10-27", "2026-10-28"],
  ["2026-12-08", "2026-12-09"],
  ["2027-01-26", "2027-01-27"],
  ["2027-03-16", "2027-03-17"],
  ["2027-04-27", "2027-04-28"],
  ["2027-06-08", "2027-06-09"],
  ["2027-07-27", "2027-07-28"],
  ["2027-09-14", "2027-09-15"],
  ["2027-10-26", "2027-10-27"],
  ["2027-12-07", "2027-12-08"],
] as const;

export function upcomingFomcMeetings(today: string) {
  return FOMC_MEETINGS.filter(([, end]) => end >= today);
}
