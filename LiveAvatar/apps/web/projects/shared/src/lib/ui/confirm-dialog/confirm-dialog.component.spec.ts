import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ConfirmDialogComponent, ConfirmDialogData } from './confirm-dialog.component';

describe('ConfirmDialogComponent', () => {
  let fixture: ComponentFixture<ConfirmDialogComponent>;
  const data: ConfirmDialogData = {
    title: 'Pause deployment?',
    body: 'New conversations will be refused.',
    confirmLabel: 'Pause deployment',
    destructive: true,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConfirmDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: jest.fn() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ConfirmDialogComponent);
    fixture.detectChanges();
  });

  it('renders the title and body verbatim', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Pause deployment?');
    expect(el.textContent).toContain('New conversations will be refused.');
  });

  it('renders a Cancel button and the given confirm label', () => {
    const el: HTMLElement = fixture.nativeElement;
    const buttons = Array.from(el.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(buttons).toContain('Cancel');
    expect(buttons).toContain('Pause deployment');
  });
});
