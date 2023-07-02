function byteToString(byte: number) {
    return "\\" + byte.toString(10);
}

function encodeByte(byte: number): string {
    return byteToString(0b10000000 | (byte & 0b00111111));
}

function encodeCodePoint(val: number): string {
    let chunk = "";

    // 2-byte sequence
    if (val < 0x800) { 
        chunk = byteToString(0b11000000 | ((val >> 6) & 0b00111111));
    }
    // 3-byte sequence
    else if (val < 0x10000) {
        chunk = byteToString(0b11100000 | ((val >> 12) & 0b00011111));
        chunk += encodeByte(val >> 6);
    }
    // 4-byte sequence
    else {
        chunk = byteToString(0b11110000 | ((val >> 18) & 0b00001111));
        chunk += encodeByte(val >> 12);
        chunk += encodeByte(val >> 6);
    }

    return chunk + encodeByte(val);
}

export function encodeUTF8(str: string): string {
    let head = 0;
    let tail = 0;
    let buffer = "";

    while (tail < str.length) {
        const codePoint = str.codePointAt(tail)!;

        // Unicode character
        if (codePoint > 0xFF) {
            buffer += str.slice(head, tail);

            // Skip UTF-16 low surrogates
            if ((codePoint < 0xDC00) || (codePoint > 0xDFFF)) {
                buffer += encodeCodePoint(codePoint);
            }

            head = tail + 1;            
        }

        tail++;
    }

    // while (tail < str.length) {
    //     const codePoint = str.codePointAt(tail)!;

    //     // Skip UTF-16 low surrogates
    //     if ((codePoint >= 0xDC00) && (codePoint <= 0xDFFF)) {
    //         buffer += str.slice(head, tail);
    //         head = ++tail;
    //         continue;
    //     }

    //     // Unicode character
    //     if (codePoint > 0xFF) {
    //         buffer += str.slice(head, tail);
    //         buffer += `\\u{${codePoint.toString(16)}}`;//encodeCodePoint(codePoint);
    //         head = tail + 1;
    //     }

    //     tail++;
    // }

    return buffer + str.slice(head, tail);
}
