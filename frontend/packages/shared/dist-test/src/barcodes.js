const NOMA_BARCODE_PATTERN = /^\d{11}$/;
const CONTROL_CHARS_PATTERN = /[\u0000-\u001f\u007f]/g;
const normalizeScannerPayload = (raw) => raw
    .replace(CONTROL_CHARS_PATTERN, "")
    .trim();
export const crc16Xmodem = (input) => {
    let crc = 0x0000;
    for (let i = 0; i < input.length; i += 1) {
        crc ^= input.charCodeAt(i) << 8;
        for (let bit = 0; bit < 8; bit += 1) {
            if ((crc & 0x8000) !== 0) {
                crc = ((crc << 1) ^ 0x1021) & 0xffff;
            }
            else {
                crc = (crc << 1) & 0xffff;
            }
        }
    }
    return crc;
};
export const validateNomaBarcode = (scannedCode) => {
    const normalizedCode = normalizeScannerPayload(scannedCode);
    if (!NOMA_BARCODE_PATTERN.test(normalizedCode)) {
        return {
            error: "A detektált kód nem NoMa vonalkód",
            identifier: null,
        };
    }
    const identifier = normalizedCode.slice(0, 6);
    const encodedCrc = normalizedCode.slice(6);
    const computedCrc = crc16Xmodem(identifier).toString(10).padStart(5, "0");
    if (computedCrc !== encodedCrc) {
        return {
            error: "Érvénytelen kód vagy olvasási hiba",
            identifier: null,
        };
    }
    return {
        error: null,
        identifier,
    };
};
