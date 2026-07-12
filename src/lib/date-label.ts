const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

export function dateLabel(timestamp: number) {
  const date = new Date(timestamp);
  return `${weekdays[date.getDay()]}, ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}
