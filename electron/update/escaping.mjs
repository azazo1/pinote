// 把路径注入外部脚本前必须做的转义, 避免带空格或引号的路径破坏脚本.

export function shellSingleQuote(value) {
  const text = String(value ?? "");
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

export function powerShellSingleQuote(value) {
  const text = String(value ?? "");
  return `'${text.replaceAll("'", "''")}'`;
}
