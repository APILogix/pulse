import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENVIRONMENTS,
  ENVIRONMENT_TYPE_OPTIONS,
  environmentTemplate,
  environmentTypeLabel,
} from "../../../pulsiv_fe/src/modules/projects/environment.constants";
import { EnvironmentType } from "../../../pulsiv_fe/src/modules/projects/api/types";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const colorPattern = /^#[0-9A-Fa-f]{6}$/;

describe("frontend environment templates", () => {
  it("defines exactly one shared template for every environment type", () => {
    const types = Object.values(EnvironmentType);
    expect(Object.keys(DEFAULT_ENVIRONMENTS).sort()).toEqual([...types].sort());
    expect(ENVIRONMENT_TYPE_OPTIONS.map((option) => option.value).sort()).toEqual([...types].sort());
  });

  it("provides valid editable defaults for every predefined type", () => {
    for (const type of Object.values(EnvironmentType)) {
      const template = environmentTemplate(type);
      expect(template.type).toBe(type);
      expect(environmentTypeLabel(type)).toBe(template.label);
      expect(template.color).toMatch(colorPattern);
      if (type === EnvironmentType.CUSTOM) {
        expect(template.name).toBe("");
        expect(template.slug).toBe("");
      } else {
        expect(template.name.length).toBeGreaterThan(0);
        expect(template.slug).toMatch(slugPattern);
        expect(template.description.length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps predefined SDK slugs unique", () => {
    const slugs = Object.values(DEFAULT_ENVIRONMENTS)
      .filter((template) => template.type !== EnvironmentType.CUSTOM)
      .map((template) => template.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});