export function generateInstallmentDates(
  startDate: Date,
  dueDay: number,
  durationMonths: number,
): Date[] {
  const clampedDueDay = Math.min(dueDay, 30);
  let year = startDate.getFullYear();
  let month = startDate.getMonth(); // 0-indexed

  // Find first installment month: dueDay must fall strictly after startDate
  const candidate = dateForMonth(year, month, clampedDueDay);
  if (candidate <= startDate) {
    month += 1;
    if (month > 11) {
      month = 0;
      year++;
    }
  }

  const dates: Date[] = [];
  for (let i = 0; i < durationMonths; i++) {
    const totalMonths = month + i;
    const y = year + Math.floor(totalMonths / 12);
    const m = totalMonths % 12;
    dates.push(dateForMonth(y, m, clampedDueDay));
  }
  return dates;
}

function dateForMonth(year: number, month: number, targetDay: number): Date {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(targetDay, lastDay));
}
