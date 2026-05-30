export function localDateString(date = new Date()) {
  return date.toLocaleDateString("en-CA");
}

export function localMonthString(date = new Date()) {
  return localDateString(date).slice(0, 7);
}
