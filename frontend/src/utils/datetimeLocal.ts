export function currentDatetimeLocalValue(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function datetimeLocalToIso(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Choose a valid date and time");
  }
  // Status reports keep the clock time as entered. A UTC conversion shifts it by the local offset.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return `${value}:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) return value;
  return parsed.toISOString();
}

export function isoToDatetimeLocal(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return currentDatetimeLocalValue();
  return currentDatetimeLocalValue(parsed);
}
