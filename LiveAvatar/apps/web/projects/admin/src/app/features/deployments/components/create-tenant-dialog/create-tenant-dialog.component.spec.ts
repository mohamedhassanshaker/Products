import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import type { AppClientError } from '@liveavatar/web-shared';
import { CreateTenantDialogComponent } from './create-tenant-dialog.component';
import { DeploymentsService } from '../../services/deployments.service';

describe('CreateTenantDialogComponent', () => {
  let fixture: ComponentFixture<CreateTenantDialogComponent>;
  let component: CreateTenantDialogComponent;
  let deployments: { create: jest.Mock };
  let dialogRef: { close: jest.Mock };

  beforeEach(async () => {
    deployments = { create: jest.fn() };
    dialogRef = { close: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [CreateTenantDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: DeploymentsService, useValue: deployments },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CreateTenantDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('auto-suggests a slug from the name until the user edits the slug manually', () => {
    component.form.controls.name.setValue('Acme Corp');
    component.onNameInput();
    expect(component.form.controls.slug.value).toBe('acme-corp');

    component.form.controls.slug.setValue('custom-slug');
    component.onSlugInput();

    component.form.controls.name.setValue('Acme Corp 2');
    component.onNameInput();
    expect(component.form.controls.slug.value).toBe('custom-slug');
  });

  it('disables submit until name and slug are both valid', () => {
    expect(component.submitDisabled()).toBe(true);
    component.form.controls.name.setValue('Acme');
    component.form.controls.slug.setValue('acme');
    expect(component.submitDisabled()).toBe(false);
  });

  it('creates the tenant and closes the dialog with the result', () => {
    deployments.create.mockReturnValue(of({ id: 't-1', name: 'Acme', slug: 'acme' }));
    component.form.controls.name.setValue('Acme');
    component.form.controls.slug.setValue('acme');
    component.onSubmit();
    expect(deployments.create).toHaveBeenCalledWith({ name: 'Acme', slug: 'acme' });
    expect(dialogRef.close).toHaveBeenCalledWith({ id: 't-1', name: 'Acme', slug: 'acme' });
  });

  it('flags an empty or over-length name as invalid once touched', () => {
    component.form.controls.name.setValue('');
    component.form.controls.name.markAsTouched();
    expect(component.nameInvalid()).toBe(true);

    component.form.controls.name.setValue('a'.repeat(81));
    expect(component.nameInvalid()).toBe(true);

    component.form.controls.name.setValue('Acme');
    expect(component.nameInvalid()).toBe(false);
  });

  it('does nothing and marks fields touched when submit is called while disabled', () => {
    component.onSubmit();
    expect(deployments.create).not.toHaveBeenCalled();
    expect(component.form.controls.name.touched).toBe(true);
    expect(component.form.controls.slug.touched).toBe(true);
  });

  it('closes with undefined on cancel', () => {
    component.onCancel();
    expect(dialogRef.close).toHaveBeenCalledWith(undefined);
  });

  it('shows TENANT_SLUG_EXISTS on the slug field', () => {
    const error: AppClientError = {
      status: 409,
      code: 'TENANT_SLUG_EXISTS',
      message: 'A tenant with this slug already exists.',
      details: {},
    };
    deployments.create.mockReturnValue(throwError(() => error));
    component.form.controls.name.setValue('Acme');
    component.form.controls.slug.setValue('acme');
    component.onSubmit();
    expect(component.form.controls.slug.getError('server')).toBe('A tenant with this slug already exists.');
  });

  it('shows TENANT_LIMIT_REACHED as a dialog alert', () => {
    const error: AppClientError = {
      status: 400,
      code: 'TENANT_LIMIT_REACHED',
      message: 'This platform instance supports at most 500 tenants.',
      details: {},
    };
    deployments.create.mockReturnValue(throwError(() => error));
    component.form.controls.name.setValue('Acme');
    component.form.controls.slug.setValue('acme');
    component.onSubmit();
    expect(component.dialogAlert()).toBe('This platform instance supports at most 500 tenants.');
  });

  it('shows TENANT_NAME_INVALID on the name field', () => {
    const error: AppClientError = {
      status: 400,
      code: 'TENANT_NAME_INVALID',
      message: 'Name is required and must be 1–80 characters.',
      details: {},
    };
    deployments.create.mockReturnValue(throwError(() => error));
    component.form.controls.name.setValue('Acme');
    component.form.controls.slug.setValue('acme');
    component.onSubmit();
    expect(component.form.controls.name.getError('server')).toBe('Name is required and must be 1–80 characters.');
  });

  it('shows a generic dialog alert for an unrecognized error code', () => {
    const error: AppClientError = { status: 500, code: 'INTERNAL_ERROR', message: 'boom', details: {} };
    deployments.create.mockReturnValue(throwError(() => error));
    component.form.controls.name.setValue('Acme');
    component.form.controls.slug.setValue('acme');
    component.onSubmit();
    expect(component.dialogAlert()).toBe('Could not create the deployment. Check your connection and try again.');
  });
});
