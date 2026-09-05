import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody } from "@nextbot/ui/components/ui/dialog";
import { Button } from "@nextbot/ui/components/ui/button";
import { useWidgetStore } from "../store.js";

/** Every language renders in its own script/demonym — tenant-configured order, not
 * alphabetically re-sorted (`docs/design/UX_GUIDELINES.md` §5.2.4/§5.4). A fixed,
 * small default list ships here since no per-tenant language-list admin screen
 * exists yet (out of this phase's scope) — English + Arabic covers the spec's own
 * two concrete example languages. */
const LANGUAGES: Array<{ code: string; label: string }> = [
  { code: "en", label: "English" },
  { code: "ar", label: "العربية" },
];

/**
 * A.1.4 — Language Selection Modal. Always a true modal dialog regardless of
 * desktop/mobile widget mode (`docs/design/UX_GUIDELINES.md` §5.5): Base UI's
 * `Dialog` traps focus while open and returns it to the trigger (the header's
 * language-toggle button) on close/Escape — the same behavior already verified
 * live for the Admin Console's `Dialog` family (Plan Phase 2, Batch B).
 */
export function LanguageModal() {
  const { languageModalOpen, closeLanguageModal, selectLanguage } = useWidgetStore();

  return (
    <Dialog open={languageModalOpen} onOpenChange={(open) => !open && closeLanguageModal()}>
      <DialogContent className="max-w-[min(90vw,320px)] p-4">
        <DialogHeader>
          <DialogTitle className="text-base">Choose a language</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="grid grid-cols-2 gap-2">
            {LANGUAGES.map((lang) => (
              <Button key={lang.code} type="button" variant="outline" onClick={() => void selectLanguage(lang.code)}>
                {lang.label}
              </Button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Your existing messages won&apos;t be translated.</p>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
