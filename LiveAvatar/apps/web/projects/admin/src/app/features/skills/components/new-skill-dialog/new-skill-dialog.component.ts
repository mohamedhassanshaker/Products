import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { SkillDto } from '@liveavatar/contracts';
import type { AppClientError } from '@liveavatar/web-shared';
import { SkillsLibraryStore } from '../../store/skills-library.store';

/**
 * "+ New skill" dialog (Skills library, Phase 13, BL-049/050/051). Mirrors
 * `ToolDialogComponent`'s shape (`features/tools/components/tool-dialog/`)
 * but minimal — per `UX_SCOPE.md`'s "'+ New skill' opens the editor," this
 * dialog only captures the one field (`name`) needed to create the `Skill`
 * row + its v1 draft `SkillVersion`; every other field is filled in on the
 * editor route the caller navigates to next.
 */
@Component({
  selector: 'la-new-skill-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './new-skill-dialog.component.html',
  styleUrls: ['../../../../shared/dialog-shared.scss'],
})
export class NewSkillDialogComponent {
  private readonly store = inject(SkillsLibraryStore);
  private readonly dialogRef = inject(MatDialogRef<NewSkillDialogComponent, SkillDto | undefined>);

  readonly name = signal('');
  readonly submitting = signal(false);
  readonly dialogAlert = signal<string | null>(null);
  readonly nameError = signal<string | null>(null);

  submitDisabled(): boolean {
    return this.submitting() || this.name().trim().length === 0;
  }

  onCancel(): void {
    this.dialogRef.close(undefined);
  }

  onSubmit(): void {
    if (this.submitDisabled()) {
      return;
    }
    this.submitting.set(true);
    this.dialogAlert.set(null);
    this.nameError.set(null);

    this.store.create(
      { name: this.name().trim() },
      (skill) => {
        this.submitting.set(false);
        this.dialogRef.close(skill);
      },
      (error) => this.handleError(error),
    );
  }

  private handleError(error: AppClientError): void {
    this.submitting.set(false);
    switch (error.code) {
      case 'SKILL_NAME_REQUIRED':
      case 'SKILL_SLUG_EXISTS':
        this.nameError.set(error.message);
        break;
      default:
        this.dialogAlert.set('Could not create this skill. Check your connection and try again.');
    }
  }
}
