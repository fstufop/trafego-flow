import { generateInstallmentDates } from './installment-dates.helper.js';

describe('generateInstallmentDates', () => {
  it('starts next month when dueDay is before startDate day', () => {
    // startDate Jan 15, dueDay 10 → first due Feb 10
    const result = generateInstallmentDates(new Date(2026, 0, 15), 10, 3);
    expect(result).toEqual([new Date(2026, 1, 10), new Date(2026, 2, 10), new Date(2026, 3, 10)]);
  });

  it('starts current month when dueDay is after startDate day', () => {
    // startDate Jan 5, dueDay 10 → first due Jan 10
    const result = generateInstallmentDates(new Date(2026, 0, 5), 10, 3);
    expect(result).toEqual([new Date(2026, 0, 10), new Date(2026, 1, 10), new Date(2026, 2, 10)]);
  });

  it('starts next month when dueDay equals startDate day', () => {
    // dueDay on the same day as startDate: use next month
    const result = generateInstallmentDates(new Date(2026, 0, 10), 10, 1);
    expect(result).toEqual([new Date(2026, 1, 10)]);
  });

  it('clamps to Feb 28 for dueDay 30 in a non-leap year', () => {
    const result = generateInstallmentDates(new Date(2026, 0, 1), 30, 2);
    expect(result[0]).toEqual(new Date(2026, 0, 30)); // Jan 30 exists
    expect(result[1]).toEqual(new Date(2026, 1, 28)); // Feb 28 in 2026
  });

  it('clamps to Feb 29 for dueDay 30 in a leap year', () => {
    const result = generateInstallmentDates(new Date(2028, 0, 1), 30, 2);
    expect(result[0]).toEqual(new Date(2028, 0, 30));
    expect(result[1]).toEqual(new Date(2028, 1, 29)); // 2028 is a leap year
  });

  it('wraps correctly across year boundary', () => {
    const result = generateInstallmentDates(new Date(2026, 10, 1), 15, 3);
    expect(result).toEqual([
      new Date(2026, 10, 15), // Nov 15
      new Date(2026, 11, 15), // Dec 15
      new Date(2027, 0, 15),  // Jan 15
    ]);
  });

  it('generates exactly durationMonths installments', () => {
    const result = generateInstallmentDates(new Date(2026, 0, 1), 10, 12);
    expect(result).toHaveLength(12);
  });
});
