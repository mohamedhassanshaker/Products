import { describe, expect, it } from "vitest";
import { semanticColors } from "@shj3/tokens";
import {
  ManageAppearance,
  SYSTEM_DEFAULT_SKIN_ID,
  type SaveTenantAppearanceCommand,
} from "./manage-appearance.js";
import { FakeThemeRepository } from "../testing/fakes.js";
import type { TenantBrandingScalars } from "../ports/theme-repository.js";

function branding(): TenantBrandingScalars {
  return {
    appTitle: "Test Tenant",
    defaultMode: "System",
    defaultDirection: "LTR",
    density: "Comfortable",
    fontSize: "0.875rem",
    shadowDepth: "1",
    sidebarStyle: "neutral",
  };
}

function saveCommand(
  overrides: Partial<SaveTenantAppearanceCommand> = {},
): SaveTenantAppearanceCommand {
  return {
    editingSkinId: null,
    skinName: "My Organisation",
    skinDescription: null,
    light: semanticColors.light,
    dark: semanticColors.dark,
    branding: branding(),
    updatedByStaffUserId: "staff-1",
    ...overrides,
  };
}

describe("ManageAppearance.saveTenantAppearance — atomic, gate-blocked on a bad candidate", () => {
  it("persists a valid candidate and returns the new skin id", async () => {
    const repo = new FakeThemeRepository();
    const result = await new ManageAppearance(repo).saveTenantAppearance(saveCommand());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const saved = await repo.readTenantSkinDetail(result.skinId);
    expect(saved?.name).toBe("My Organisation");
    expect(saved?.light).toEqual(semanticColors.light);

    // The tenant is now active on this skin, with the branding scalars persisted too
    // (§9.2 rule 1 — one atomic save, not colours-then-scalars).
    const readBack = await repo.readTenantBranding();
    expect(readBack?.appTitle).toBe("Test Tenant");
    expect(readBack?.activeSkinColors.light).toEqual(semanticColors.light);
  });

  it("calling the REAL contrast gate: a bad candidate is rejected and NOTHING is written", async () => {
    const repo = new FakeThemeRepository();
    const corruptedLight = { ...semanticColors.light, foreground: semanticColors.light.background };

    const result = await new ManageAppearance(repo).saveTenantAppearance(
      saveCommand({ light: corruptedLight }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.lightReport).not.toBeNull();
    expect(result.lightReport?.blockers.some((b) => b.pair.fg === "foreground")).toBe(true);
    // The dark mode passed independently — its report is null, proving each mode is
    // gated on its OWN merits, not a combined pass/fail.
    expect(result.darkReport).toBeNull();

    // Nothing was written — the whole point of blocking rather than warning.
    expect(await repo.readTenantBranding()).toBeNull();
    expect(await repo.listTenantSkins()).toEqual([]);
  });

  it("both modes independently corrupted are both named in the result", async () => {
    const repo = new FakeThemeRepository();
    const corruptedLight = { ...semanticColors.light, foreground: semanticColors.light.background };
    const corruptedDark = { ...semanticColors.dark, mutedForeground: semanticColors.dark.muted };

    const result = await new ManageAppearance(repo).saveTenantAppearance(
      saveCommand({ light: corruptedLight, dark: corruptedDark }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.lightReport?.blockers.length).toBeGreaterThan(0);
    expect(result.darkReport?.blockers.length).toBeGreaterThan(0);
  });

  it("a name collision with an existing skin is a graceful nameTaken result, not a thrown error", async () => {
    // The real bug this guards against: a fixed default skin name (this screen's
    // own, or the platform-admin cross-tenant screen's) colliding with a skin the
    // tenant already has under that exact name — including one left behind by a
    // prior save-then-reset cycle (`ResetAppearance.resetTenantBranding` clears
    // `TenantBranding` but never touches the `Skin` row it stops pointing at), which
    // used to surface as a raw, uncaught `PrismaClientKnownRequestError` on
    // `UQ_Skins_name` all the way to the browser.
    const repo = new FakeThemeRepository();
    const manage = new ManageAppearance(repo);
    const first = await manage.saveTenantAppearance(saveCommand({ skinName: "Custom skin" }));
    expect(first.ok).toBe(true);

    const second = await manage.saveTenantAppearance(
      saveCommand({ editingSkinId: null, skinName: "Custom skin" }),
    );

    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    expect(second.nameTaken).toBe(true);
    expect(second.lightReport).toBeNull();
    expect(second.darkReport).toBeNull();
  });

  it("editing an existing skin updates it in place rather than creating a second one", async () => {
    const repo = new FakeThemeRepository();
    const manage = new ManageAppearance(repo);
    const first = await manage.saveTenantAppearance(saveCommand());
    if (!first.ok) throw new Error("unreachable");

    const edited = { ...semanticColors.light, primary: "#123456" };
    const second = await manage.saveTenantAppearance(
      saveCommand({ editingSkinId: first.skinId, light: edited }),
    );
    if (!second.ok) throw new Error("unreachable");

    expect(second.skinId).toBe(first.skinId);
    const skins = await repo.listTenantSkins();
    expect(skins.length).toBe(1);
    const detail = await repo.readTenantSkinDetail(first.skinId);
    expect(detail?.light.primary).toBe("#123456");
  });
});

describe("ManageAppearance.applyTenantSkin", () => {
  it("applying the synthetic system-default entry resets tenant branding (no tenant Skins row to repoint)", async () => {
    const repo = new FakeThemeRepository({
      tenantBranding: {
        ...branding(),
        activeSkinColors: { light: semanticColors.light, dark: semanticColors.dark },
        logoLightUrl: null,
        logoDarkUrl: null,
        faviconUrl: null,
      },
    });
    await new ManageAppearance(repo).applyTenantSkin(SYSTEM_DEFAULT_SKIN_ID, "staff-1", "LTR");
    expect(await repo.readTenantBranding()).toBeNull();
  });

  it("applying a real tenant skin repoints TenantBranding.activeSkinId to it", async () => {
    const repo = new FakeThemeRepository();
    const manage = new ManageAppearance(repo);
    const { skinId } = await manage.duplicateSystemDefaultSkin("A Custom Skin", "staff-1");

    await manage.applyTenantSkin(skinId, "staff-1", "LTR");

    const skins = await repo.listTenantSkins();
    expect(skins.find((s) => s.id === skinId)?.isActive).toBe(true);
  });
});

describe("ManageAppearance.duplicateTenantSkin / duplicateSystemDefaultSkin", () => {
  it("duplicating the system default creates a real, unapplied tenant skin with the system's own colours", async () => {
    const repo = new FakeThemeRepository();
    const { skinId } = await new ManageAppearance(repo).duplicateSystemDefaultSkin(
      "My Copy",
      "staff-1",
    );

    const detail = await repo.readTenantSkinDetail(skinId);
    expect(detail?.name).toBe("My Copy");
    expect(detail?.isActive).toBe(false);
    expect(detail?.light).toEqual(semanticColors.light);
  });

  it("duplicating an existing tenant skin copies its colours under a new name, unapplied", async () => {
    const repo = new FakeThemeRepository();
    const manage = new ManageAppearance(repo);
    const source = await manage.saveTenantAppearance(saveCommand());
    if (!source.ok) throw new Error("unreachable");

    const { skinId: copyId } = await manage.duplicateTenantSkin(source.skinId, "Copy", "staff-2");

    const copy = await repo.readTenantSkinDetail(copyId);
    expect(copy?.name).toBe("Copy");
    expect(copy?.isActive).toBe(false);
    expect(copy?.light).toEqual(semanticColors.light);
    // The original is untouched and still the active one.
    const original = await repo.readTenantSkinDetail(source.skinId);
    expect(original?.isActive).toBe(true);
  });

  it("duplicating a skin that no longer exists fails loudly rather than silently creating an empty one", async () => {
    const repo = new FakeThemeRepository();
    await expect(
      new ManageAppearance(repo).duplicateTenantSkin("does-not-exist", "Copy", "staff-1"),
    ).rejects.toThrow(/no longer exists/);
  });
});

describe("ManageAppearance.deleteTenantSkin — the trigger-aware block, surfaced legibly", () => {
  it("deleting the currently-active skin is blocked with a real, legible reason, not a raw error", async () => {
    const repo = new FakeThemeRepository();
    const manage = new ManageAppearance(repo);
    const saved = await manage.saveTenantAppearance(saveCommand());
    if (!saved.ok) throw new Error("unreachable");

    const result = await manage.deleteTenantSkin(saved.skinId);

    expect(result.blocked).toBe(true);
    if (!result.blocked) throw new Error("unreachable");
    expect(result.reason).toMatch(/currently applied|active tenant branding/i);
    // Still there — the block genuinely prevented the delete, not just reported one.
    expect(await repo.readTenantSkinDetail(saved.skinId)).not.toBeNull();
  });

  it("deleting a non-active skin succeeds", async () => {
    const repo = new FakeThemeRepository();
    const manage = new ManageAppearance(repo);
    const { skinId } = await manage.duplicateSystemDefaultSkin("Unused", "staff-1");

    const result = await manage.deleteTenantSkin(skinId);

    expect(result.blocked).toBe(false);
    expect(await repo.readTenantSkinDetail(skinId)).toBeNull();
  });
});

describe("ManageAppearance.renameTenantSkin", () => {
  it("renames a skin's metadata without touching its colours", async () => {
    const repo = new FakeThemeRepository();
    const manage = new ManageAppearance(repo);
    const { skinId } = await manage.duplicateSystemDefaultSkin("Old Name", "staff-1");

    await manage.renameTenantSkin(skinId, "New Name", "A new description");

    const detail = await repo.readTenantSkinDetail(skinId);
    expect(detail?.name).toBe("New Name");
    expect(detail?.description).toBe("A new description");
    expect(detail?.light).toEqual(semanticColors.light);
  });
});

describe("ManageAppearance.applyPersonalSkin / savePersonalPreferenceScalars", () => {
  it("a user can apply an existing tenant skin to their own preference", async () => {
    const repo = new FakeThemeRepository();
    const manage = new ManageAppearance(repo);
    const { skinId } = await manage.duplicateSystemDefaultSkin("Personal Pick", "staff-1");

    await manage.applyPersonalSkin("user-1", skinId);

    const preference = await repo.readUserPreference("user-1");
    expect(preference?.personalSkinColors?.light).toEqual(semanticColors.light);
  });

  it("applying the system-default sentinel personally clears the personal skin (defers to the tenant tier)", async () => {
    const repo = new FakeThemeRepository();
    const manage = new ManageAppearance(repo);
    const { skinId } = await manage.duplicateSystemDefaultSkin("Personal Pick", "staff-1");
    await manage.applyPersonalSkin("user-1", skinId);

    await manage.applyPersonalSkin("user-1", SYSTEM_DEFAULT_SKIN_ID);

    expect((await repo.readUserPreference("user-1"))?.personalSkinColors).toBeNull();
  });

  it("applying a dangling skin id fails loudly rather than writing an unresolvable pointer", async () => {
    const repo = new FakeThemeRepository();
    await expect(
      new ManageAppearance(repo).applyPersonalSkin("user-1", "does-not-exist"),
    ).rejects.toThrow(/no longer exists/);
  });

  it("saves personal scalar preferences together, independent of any skin choice", async () => {
    const repo = new FakeThemeRepository();
    await new ManageAppearance(repo).savePersonalPreferenceScalars("user-1", {
      mode: "Dark",
      density: "Compact",
      direction: null,
      fontSize: "1rem",
      reducedMotion: true,
    });

    const preference = await repo.readUserPreference("user-1");
    expect(preference?.mode).toBe("Dark");
    expect(preference?.density).toBe("Compact");
    expect(preference?.reducedMotion).toBe(true);
  });
});

describe("ManageAppearance.listSkinsForManager", () => {
  it("always lists the synthetic system-default entry first, active when there is no tenant branding", async () => {
    const repo = new FakeThemeRepository();
    const entries = await new ManageAppearance(repo).listSkinsForManager(false);

    const first = entries[0];
    if (!first) throw new Error("unreachable — the system entry is always present");
    expect(first.id).toBe(SYSTEM_DEFAULT_SKIN_ID);
    expect(first.isSystem).toBe(true);
    expect(first.isActive).toBe(true);
  });

  it("lists real tenant skins alongside the system entry, correctly marking which is active", async () => {
    const repo = new FakeThemeRepository();
    const manage = new ManageAppearance(repo);
    const saved = await manage.saveTenantAppearance(saveCommand());
    if (!saved.ok) throw new Error("unreachable");

    const entries = await manage.listSkinsForManager(true);

    expect(entries.some((e) => e.id === SYSTEM_DEFAULT_SKIN_ID && e.isActive === false)).toBe(true);
    expect(entries.some((e) => e.id === saved.skinId && e.isActive === true && !e.isSystem)).toBe(
      true,
    );
  });
});
