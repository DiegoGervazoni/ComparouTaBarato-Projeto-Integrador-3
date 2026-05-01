import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import utils from "../src/utils.js";

const { calcularDistanciaKm } = utils;

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

  it("mantem mercados de Campinas longe das coordenadas de Itapira", () => {
    const itapira = { lat: -22.4350, lng: -46.8230 };
    const campinasReadings = iotPayload.readings.filter(
      item => String(item.region).toLowerCase() === "campinas"
    );

    expect(campinasReadings.length).toBeGreaterThan(0);
    for (const item of campinasReadings) {
      const km = calcularDistanciaKm(itapira.lat, itapira.lng, item.lat, item.lng);
      expect(km).toBeGreaterThan(40);
    }
  });
});
