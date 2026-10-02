import cron from 'node-cron';

function matchesCronSegment(segment: string, value: number, min: number, max: number) {
  const [base, stepToken] = segment.split('/');
  const step = stepToken ? Number(stepToken) : 1;

  if (!Number.isInteger(step) || step <= 0) {
    return false;
  }

  const range = parseCronRange(base, min, max);
  if (!range) {
    return false;
  }

  if (value < range.start || value > range.end) {
    return false;
  }

  return (value - range.start) % step === 0;
}

function parseCronRange(token: string | undefined, min: number, max: number) {
  if (!token || token === '*') {
    return { start: min, end: max };
  }

  if (token.includes('-')) {
    const [startToken, endToken] = token.split('-');
    const start = Number(startToken);
    const end = Number(endToken);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
      return null;
    }

    return { start, end };
  }

  const value = Number(token);
  if (!Number.isInteger(value) || value < min || value > max) {
    return null;
  }

  return { start: value, end: value };
}

function matchesCronField(field: string, value: number, min: number, max: number, sundayCanBeSeven = false) {
  const normalizedField = field === '?' ? '*' : field;
  const candidateValues = sundayCanBeSeven && value === 0 ? [0, 7] : [value];

  return normalizedField.split(',').some((segment) =>
    candidateValues.some((candidate) => matchesCronSegment(segment, candidate, min, max)),
  );
}

export function shouldRunNow(cronExpression: string | null, now = new Date()): boolean {
  if (!cronExpression || !cron.validate(cronExpression)) {
    return false;
  }

  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return false;
  }

  const [minute, hour, dayOfMonth, month, weekDay] = parts;

  return matchesCronField(minute, now.getMinutes(), 0, 59)
    && matchesCronField(hour, now.getHours(), 0, 23)
    && matchesCronField(dayOfMonth, now.getDate(), 1, 31)
    && matchesCronField(month, now.getMonth() + 1, 1, 12)
    && matchesCronField(weekDay, now.getDay(), 0, 7, true);
}
