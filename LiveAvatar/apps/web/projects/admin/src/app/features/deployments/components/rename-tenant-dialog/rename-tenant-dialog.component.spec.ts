import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import type { AppClientError } from '@liveavatar/web-shared';
import { RenameTenantDialogComponent, RenameTenantDialogData } from './rename-tenant-dialog.component';
import { DeploymentsService } from '../../services/deployments.service';

describe('RenameTenantDialogComponent', () => {
  let fixture: ComponentFixture<RenameTenantDialogComponent>;
  let component: RenameTenantDialogComponent;
  let deployments: { rename: jest.Mock; get: jest.Mock };
  let dialogRef: { close: jest.Mock };

  const data: RenameTenantDialogData = {
    id: 't-1',
    name: 'Acme',
    slug: 'acme',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    deployments = { rename: jest.fn(), get: jest.fn() };
    dialogRef = { close: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [RenameTenantDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: DeploymentsService, useValue: deployments },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RenameTenantDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('pre-fills the name field and shows the read-only slug', () => {
    expect(component.form.controls.name.value).toBe('Acme');
    expect(fixture.nativeElement.textContent).toContain('acme');
  });

  it('flags an empty or over-length name as invalid once touched', () => {
    component.form.controls.name.setValue('');
    component.form.controls.name.markAsTouched();
    expect(component.nameInvalid()).toBe(true);
    component.form.controls.name.setValue('Acme');
    expect(component.nameInvalid()).toBe(false);
  });

  it('does nothing and marks fields touched when submit is called while disabled', () => {
    component.form.controls.name.setValue('');
    component.onSubmit();
    expect(deployments.rename).not.toHaveBeenCalled();
    expect(component.form.controls.name.touched).toBe(true);
  });

  it('closes with undefined on cancel', () => {
    component.onCancel();
    expect(dialogRef.close).toHaveBeenCalledWith(undefined);
  });

  it('shows TENANT_NAME_INVALID on the name field', () => {
    const error: AppClientError = {
      status: 400,
      code: 'TENANT_NAME_INVALID',
      message: 'Name is required and must be 1–80 characters.',
      details: {},
    };
    deployments.rename.mockReturnValue(throwError(() => error));
    component.form.controls.name.setValue('Acme Renamed');
    component.onSubmit();
    expect(component.form.controls.name.getError('server')).toBe('Name is required and must be 1–80 characters.');
  });

  it('shows TENANT_NOT_FOUND / TENANT_FORBIDDEN as a dialog alert', () => {
    const error: AppClientError = { status: 404, code: 'TENANT_NOT_FOUND', message: 'Tenant not found.', details: {} };
    deployments.rename.mockReturnValue(throwError(() => error));
    component.form.controls.name.setValue('Acme Renamed');
    component.onSubmit();
    expect(component.dialogAlert()).toBe('Tenant not found.');
  });

  it('shows a generic dialog alert for an unrecognized error code', () => {
    const error: AppClientError = { status: 500, code: 'INTERNAL_ERROR', message: 'boom', details: {} };
    deployments.rename.mockReturnValue(throwError(() => error));
    component.form.controls.name.setValue('Acme Renamed');
    component.onSubmit();
    expect(component.dialogAlert()).toBe('Could not rename the deployment. Check your connection and try again.');
  });

  it('renames and closes with the updated tenant, sending If-Match: updatedAt', () => {
    deployments.rename.mockReturnValue(of({ id: 't-1', name: 'Acme Renamed' }));
    component.form.controls.name.setValue('Acme Renamed');
    component.onSubmit();
    expect(deployments.rename).toHaveBeenCalledWith('t-1', 'Acme Renamed', '2026-01-01T00:00:00.000Z');
    expect(dialogRef.close).toHaveBeenCalledWith({ id: 't-1', name: 'Acme Renamed' });
  });

  it('shows TENANT_CONFLICT with a Retry that refreshes If-Match', () => {
    const error: AppClientError = {
      status: 409,
      code: 'TENANT_CONFLICT',
      message: 'Tenant was modified by another user. Reload and retry.',
      details: {},
    };
    deployments.rename.mockReturnValue(throwError(() => error));
    component.form.controls.name.setValue('Acme Renamed');
    component.onSubmit();
    expect(component.conflict()).toBe(true);

    deployments.get.mockReturnValue(of({ id: 't-1', updated_at: '2026-01-02T00:00:00.000Z' }));
    component.onRetry();
    expect(component.conflict()).toBe(false);

    deployments.rename.mockReturnValue(of({ id: 't-1', name: 'Acme Renamed' }));
    component.onSubmit();
    expect(deployments.rename).toHaveBeenLastCalledWith('t-1', 'Acme Renamed', '2026-01-02T00:00:00.000Z');
  });
});
