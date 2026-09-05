import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NewSkillDialogComponent } from './new-skill-dialog.component';
import { SkillsLibraryStore } from '../../store/skills-library.store';

describe('NewSkillDialogComponent', () => {
  let fixture: ComponentFixture<NewSkillDialogComponent>;
  let component: NewSkillDialogComponent;
  let store: { create: jest.Mock };
  let dialogRef: { close: jest.Mock };

  async function setup() {
    store = { create: jest.fn() };
    dialogRef = { close: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [NewSkillDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: SkillsLibraryStore, useValue: store },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NewSkillDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('disables submit until a name is entered', async () => {
    await setup();
    expect(component.submitDisabled()).toBe(true);
    component.name.set('refunds');
    expect(component.submitDisabled()).toBe(false);
  });

  it('treats a whitespace-only name as still disabled', async () => {
    await setup();
    component.name.set('   ');
    expect(component.submitDisabled()).toBe(true);
  });

  it('creates a skill and closes the dialog with the result', async () => {
    await setup();
    store.create.mockImplementation((_body, onSuccess) => onSuccess({ id: 'skill-1', name: 'refunds' }));
    component.name.set('refunds');

    component.onSubmit();

    expect(store.create).toHaveBeenCalledWith({ name: 'refunds' }, expect.any(Function), expect.any(Function));
    expect(dialogRef.close).toHaveBeenCalledWith({ id: 'skill-1', name: 'refunds' });
  });

  it('maps SKILL_SLUG_EXISTS to the name field and does not close the dialog', async () => {
    await setup();
    store.create.mockImplementation((_body, _onSuccess, onError) =>
      onError({ code: 'SKILL_SLUG_EXISTS', message: 'A skill with this name already exists for this tenant.', status: 409, details: {} }),
    );
    component.name.set('refunds');

    component.onSubmit();

    expect(component.nameError()).toBe('A skill with this name already exists for this tenant.');
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('shows a generic alert for an unmapped error code', async () => {
    await setup();
    store.create.mockImplementation((_body, _onSuccess, onError) =>
      onError({ code: 'UNKNOWN', message: 'x', status: 500, details: {} }),
    );
    component.name.set('refunds');

    component.onSubmit();

    expect(component.dialogAlert()).toBe('Could not create this skill. Check your connection and try again.');
  });

  it('closes with undefined on cancel', async () => {
    await setup();
    component.onCancel();
    expect(dialogRef.close).toHaveBeenCalledWith(undefined);
  });
});
