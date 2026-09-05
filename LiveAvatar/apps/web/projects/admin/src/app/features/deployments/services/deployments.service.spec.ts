import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { TenantsApiService } from '@liveavatar/web-shared';
import { DeploymentsService } from './deployments.service';

describe('DeploymentsService', () => {
  let service: DeploymentsService;
  let api: { list: jest.Mock; get: jest.Mock; create: jest.Mock; update: jest.Mock; changeStatus: jest.Mock };

  beforeEach(() => {
    api = {
      list: jest.fn(() => of({ items: [], total: 0, page: 1, page_size: 25 })),
      get: jest.fn(() => of({})),
      create: jest.fn(() => of({})),
      update: jest.fn(() => of({})),
      changeStatus: jest.fn(() => of({})),
    };
    TestBed.configureTestingModule({ providers: [{ provide: TenantsApiService, useValue: api }] });
    service = TestBed.inject(DeploymentsService);
  });

  it('delegates list() to the API client with the given query', () => {
    service.list({ q: 'acme', page: 1, page_size: 25 }).subscribe();
    expect(api.list).toHaveBeenCalledWith({ q: 'acme', page: 1, page_size: 25 });
  });

  it('delegates get() by id', () => {
    service.get('t-1').subscribe();
    expect(api.get).toHaveBeenCalledWith('t-1');
  });

  it('create() mints a fresh Idempotency-Key and forwards the body', () => {
    service.create({ name: 'Acme', slug: 'acme' }).subscribe();
    expect(api.create).toHaveBeenCalledTimes(1);
    const [body, key] = api.create.mock.calls[0];
    expect(body).toEqual({ name: 'Acme', slug: 'acme' });
    expect(key).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('rename() PATCHes with the given If-Match value', () => {
    service.rename('t-1', 'New name', '2026-01-01T00:00:00.000Z').subscribe();
    expect(api.update).toHaveBeenCalledWith('t-1', { name: 'New name' }, '2026-01-01T00:00:00.000Z');
  });

  it('changeStatus() forwards the status body', () => {
    service.changeStatus('t-1', { status: 'paused' }).subscribe();
    expect(api.changeStatus).toHaveBeenCalledWith('t-1', { status: 'paused' });
  });
});
