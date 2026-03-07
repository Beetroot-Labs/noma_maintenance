import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { crc16Xmodem, validateNomaBarcode } from "../src/barcodes.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturePathFromDist = join(__dirname, "..", "..", "tests", "fixtures", "barcodes.csv");
const fixturePathFromSource = join(__dirname, "fixtures", "barcodes.csv");
const fixturePath = existsSync(fixturePathFromDist) ? fixturePathFromDist : fixturePathFromSource;
const parseBarcodeColumn = () => {
    const csv = readFileSync(fixturePath, "utf8");
    const lines = csv.split(/\r?\n/).filter(Boolean);
    return lines
        .slice(1)
        .map((line) => line.split(",")[0]?.trim())
        .filter((value) => Boolean(value));
};
test("crc16Xmodem matches expected decimal CRC from fixture barcode column", () => {
    const barcodes = parseBarcodeColumn();
    assert.ok(barcodes.length > 0, "fixture should contain at least one barcode");
    for (const barcode of barcodes) {
        assert.equal(barcode.length, 11, `barcode should be 11 digits: ${barcode}`);
        const identifier = barcode.slice(0, 6);
        const expectedDecimalCrc = Number.parseInt(barcode.slice(6), 10);
        assert.equal(crc16Xmodem(identifier), expectedDecimalCrc, `crc mismatch for ${identifier}`);
    }
});
test("validateNomaBarcode accepts fixture barcodes", () => {
    const barcodes = parseBarcodeColumn();
    for (const barcode of barcodes) {
        const validation = validateNomaBarcode(barcode);
        assert.equal(validation.error, null, `expected valid barcode: ${barcode}`);
        assert.equal(validation.identifier, barcode.slice(0, 6), `identifier mismatch for ${barcode}`);
    }
});
test("validateNomaBarcode accepts scanner payload with trailing GS control char", () => {
    const barcode = parseBarcodeColumn()[0];
    assert.ok(barcode, "fixture should contain at least one barcode");
    const withGs = `${barcode}\u001d`;
    const validation = validateNomaBarcode(withGs);
    assert.equal(validation.error, null);
    assert.equal(validation.identifier, barcode.slice(0, 6));
});
