export type NomaBarcodeValidationResult =
  | {
      error: null;
      identifier: string;
    }
  | {
      error: string;
      identifier: null;
    };

const NOMA_BARCODE_PATTERN = /^\d{11}$/;

const crc16Xmodem = (input: string) => {
  let crc = 0x0000;

  for (let i = 0; i < input.length; i += 1) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }

  return crc;
};

export const validateNomaBarcode = (scannedCode: string): NomaBarcodeValidationResult => {
  if (!NOMA_BARCODE_PATTERN.test(scannedCode)) {
    return {
      error: "A detektált kód nem NoMa vonalkód",
      identifier: null,
    };
  }

  const identifier = scannedCode.slice(0, 6);
  const encodedCrc = scannedCode.slice(6);
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
