/**
 * Makes a file name read the way a person wrote it: "Hauptbuch%20(Nr11).pptx" becomes "Hauptbuch (Nr11).pptx". Browsers
 * and download links hand over percent-encoded names, and nobody types %20 on purpose. Only well-formed escapes are
 * decoded, so a name that merely contains a percent sign ("100% done.txt") is left alone.
 */
export function tidyFileName(name: string): string {
    let out = name;
    if (/%[0-9a-f]{2}/i.test(out)) {
        try {
            out = decodeURIComponent(out);
        } catch {
            // not valid UTF-8 escapes: keep the name as it came
        }
    }
    return out
        .normalize('NFC')
        .replace(/\p{Cc}/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}
