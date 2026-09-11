import { describe, it, expect } from "vitest";
import {
  groupSectionComponent,
  groupSectionRenders,
} from "../mach-group-rendering";
import { MachProductRow } from "../../mach/sections/MachProductRow";
import { MachStackShowcase } from "../../mach/sections/MachStackShowcase";
import { resolveGroupSections } from "#root/shared/types/homepage-group-sections";

/**
 * The two decisions the homepage makes about a group section. Both are pure
 * functions the renderer itself calls, so these assertions are about the real
 * branch taken on the page rather than about a copy of it.
 */

const STACKS = "01a06cc1-36ba-75cb-8353-5968a3889e70";
const GYM_GEAR = "01a06cc1-55a5-759e-a04b-f25cdc6ad5ff";

const GROUPS = [
  { id: STACKS, name: "Stacks & Bundles", slug: "stacks-bundles" },
  { id: GYM_GEAR, name: "Gym Gear", slug: "gym-gear" },
];

const PRODUCTS = [{ id: "p-1" }, { id: "p-2" }];

describe("groupSectionRenders", () => {
  it("renders an enabled group that has products", () => {
    expect(
      groupSectionRenders({ enabled: true }, { products: PRODUCTS }),
    ).toBe(true);
  });

  it("renders nothing for a disabled group, products or not", () => {
    expect(
      groupSectionRenders({ enabled: false }, { products: PRODUCTS }),
    ).toBe(false);
  });

  it("renders nothing for an enabled group with no products", () => {
    // An empty bordered block in a merchandising slot reads as broken, not as
    // "coming soon".
    expect(groupSectionRenders({ enabled: true }, { products: [] })).toBe(
      false,
    );
  });

  it("renders nothing while the group is still loading", () => {
    expect(
      groupSectionRenders(
        { enabled: true },
        { products: PRODUCTS, isLoading: true },
      ),
    ).toBe(false);
  });

  it("renders nothing for a group that has not been queried at all", () => {
    // A group switched on this second, before its first fetch resolves.
    expect(groupSectionRenders({ enabled: true }, undefined)).toBe(false);
  });
});

describe("groupSectionComponent", () => {
  it("gives a feature group the showcase treatment", () => {
    expect(groupSectionComponent("feature")).toBe(MachStackShowcase);
  });

  it("gives a shelf group the dense product row", () => {
    expect(groupSectionComponent("shelf")).toBe(MachProductRow);
  });

  it("keeps the current Stacks and Gym Gear treatments after the migration", () => {
    // The visual work already shipped: Stacks composes as panels, Gym Gear is
    // a shelf. Flattening both into one treatment would redesign the homepage
    // as a side effect of making groups dynamic.
    const sections = resolveGroupSections(
      {
        stacks: {
          enabled: true,
          title: "STACKS & BUNDLES",
          viewAllText: "VIEW ALL",
          viewAllLink: "/shop",
          categoryIds: [STACKS],
        },
        gymGear: {
          enabled: true,
          title: "GYM GEAR",
          viewAllText: "VIEW ALL",
          viewAllLink: "/shop",
          categoryIds: [GYM_GEAR],
        },
      },
      GROUPS,
    );

    const stacks = sections.find((s) => s.category.id === STACKS)!;
    const gym = sections.find((s) => s.category.id === GYM_GEAR)!;

    expect(groupSectionComponent(stacks.presentation)).toBe(MachStackShowcase);
    expect(groupSectionComponent(gym.presentation)).toBe(MachProductRow);
  });

  it("gives a group nobody has configured the shelf", () => {
    const [supplements] = resolveGroupSections({}, [
      { id: "new", name: "Supplements", slug: "supplements" },
    ]);

    expect(groupSectionComponent(supplements!.presentation)).toBe(
      MachProductRow,
    );
  });
});
