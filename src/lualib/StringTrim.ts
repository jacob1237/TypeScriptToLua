export function __TS__StringTrim(this: string): string {
    // http://lua-users.org/wiki/StringTrim
    // const [result] = string.gsub(this, "^[%s\xA0\uFEFF]*(.-)[%s\xA0\uFEFF]*$", "%1");
    const [result] = string.gsub(this, "^[%s%c]*(.-)[%s%c]*$", "%1");
    return result;
}
