import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const iotPayload = JSON.parse(
  readFileSync(new URL("../data/iot_readings.json", import.meta.url), "utf8")
);

describe("iot_readings.json", () => {
  it("inclui leituras para Americana", () => {
    const americanaReadings = iotPayload.readings.filter(
      item => String(item.region).toLowerCase() === "americana"
    );

    expect(americanaReadings.length).toBeGreaterThan(0);
    expect(americanaReadings.map(item => item.store)).toEqual(
      expect.arrayContaining(["Crema", "Pague Menos", "São Vicente"])
    );
  });
});
