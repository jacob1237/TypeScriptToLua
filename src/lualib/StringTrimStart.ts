export function __TS__StringTrimStart(this: string): string {
    // http://lua-users.org/wiki/StringTrim
    const [result] = string.gsub(this, "^[%s%c]*", "");
    return result;
}
